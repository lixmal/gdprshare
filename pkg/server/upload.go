package server

import (
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	uuid "github.com/nu7hatch/gouuid"

	"github.com/lixmal/gdprshare/pkg/database"
	"github.com/lixmal/gdprshare/pkg/misc"
)

// Headers a chunk carries: who is uploading, and where in the file the bytes
// belong. The offset is checked rather than trusted, so a chunk sent twice is
// refused instead of landing twice.
const (
	HeaderOwnerToken   = "X-Owner-Token"
	HeaderUploadOffset = "X-Upload-Offset"
)

// beginUpload opens a share that arrives in pieces. It answers with the file id
// and the owner token: the token is what the pieces and the finish are
// authenticated with, and it is the owner's own token afterwards.
func (s *Server) beginUpload(c *gin.Context) {
	var begin UploadBegin
	if err := c.ShouldBind(&begin); err != nil {
		apiError(c, http.StatusBadRequest, ErrCodeInvalidUpload, err.Error())
		return
	}

	created, err := s.createShare(c, begin.storedFile())
	if err != nil {
		return
	}

	// an empty file to append to, so a chunk never has to create it
	path := filepath.Join(s.config.StorePath, created.Name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		log.Printf("Failed to create file for upload %s: %s\n", created.FileId, err)
		s.abandonShare(created)
		apiError(c, http.StatusInternalServerError, ErrCodeSaveFailed, "failed to save file")
		return
	}
	if err := file.Close(); err != nil {
		log.Printf("Failed to close file for upload %s: %s\n", created.FileId, err)
	}

	c.JSON(
		http.StatusCreated,
		gin.H{
			"message":    "upload started",
			"fileId":     created.FileId,
			"ownerToken": created.OwnerToken,
			"received":   0,
		},
	)
}

// appendUpload takes the next piece of a file. The body is the ciphertext, read
// straight to disk, so a file larger than this process can hold still arrives.
func (s *Server) appendUpload(c *gin.Context) {
	storedFile, ok := s.pendingUpload(c)
	if !ok {
		return
	}

	offset, err := strconv.ParseInt(c.Request.Header.Get(HeaderUploadOffset), 10, 64)
	if err != nil || offset < 0 {
		apiError(c, http.StatusBadRequest, ErrCodeUploadOffset, "the offset is not a number")
		return
	}

	path := filepath.Join(s.config.StorePath, storedFile.Name)
	info, err := os.Stat(path)
	if err != nil {
		log.Printf("Failed to read the size of upload %s: %s\n", storedFile.FileId, err)
		apiError(c, http.StatusNotFound, ErrCodeUploadNotFound, "upload not found")
		return
	}

	// The offset says which bytes the sender believes it is sending. A chunk
	// that repeats or skips would silently corrupt the file, so it is refused
	// and the sender is told where to carry on from.
	if offset != info.Size() {
		c.Header(HeaderUploadOffset, strconv.FormatInt(info.Size(), 10))
		apiError(c, http.StatusConflict, ErrCodeUploadOffset, "the upload is at a different offset")
		return
	}

	limit := s.config.MaxUploadSize * 1024 * 1024
	if info.Size() >= limit {
		apiError(c, http.StatusRequestEntityTooLarge, ErrCodeUploadTooLarge, "the file is too large")
		return
	}

	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		log.Printf("Failed to open upload %s: %s\n", storedFile.FileId, err)
		apiError(c, http.StatusInternalServerError, ErrCodeSaveFailed, "failed to save file")
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			log.Printf("Failed to close upload %s: %s\n", storedFile.FileId, err)
		}
	}()

	// one byte past the limit is enough to know the file does not fit, and it
	// is never written
	written, err := io.Copy(file, io.LimitReader(c.Request.Body, limit-info.Size()+1))
	if err != nil {
		log.Printf("Failed to write upload %s: %s\n", storedFile.FileId, err)
		apiError(c, http.StatusInternalServerError, ErrCodeSaveFailed, "failed to save file")
		return
	}

	if info.Size()+written > limit {
		if err := file.Truncate(info.Size()); err != nil {
			log.Printf("Failed to cut upload %s back: %s\n", storedFile.FileId, err)
		}

		apiError(c, http.StatusRequestEntityTooLarge, ErrCodeUploadTooLarge, "the file is too large")
		return
	}

	c.JSON(
		http.StatusOK,
		gin.H{
			"message":  "chunk stored",
			"received": info.Size() + written,
		},
	)
}

// finishUpload turns a share that was still arriving into an ordinary one.
func (s *Server) finishUpload(c *gin.Context) {
	storedFile, ok := s.pendingUpload(c)
	if !ok {
		return
	}

	storedFile.Pending = false
	if err := s.db.Save(storedFile).Error; err != nil {
		log.Printf("Failed to finish upload %s: %s\n", storedFile.FileId, err)
		apiError(c, http.StatusInternalServerError, ErrCodeStoreFailed, "failed to store file in database")
		return
	}

	c.Header("Location", "/d/"+storedFile.FileId)
	c.JSON(
		http.StatusCreated,
		gin.H{
			"message":    "file uploaded successfully",
			"fileId":     storedFile.FileId,
			"ownerToken": storedFile.OwnerToken,
		},
	)
}

// pendingUpload reads the share a chunk belongs to, once the owner token proves
// the sender is the one who started it.
func (s *Server) pendingUpload(c *gin.Context) (*database.StoredFile, bool) {
	fileId, err := bindFileID(c)
	if err != nil {
		return nil, false
	}

	var storedFile database.StoredFile
	if err := s.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error; err != nil {
		apiError(c, http.StatusNotFound, ErrCodeUploadNotFound, "upload not found")
		return nil, false
	}

	if !s.ownsFile(c, &storedFile, c.Request.Header.Get(HeaderOwnerToken)) {
		return nil, false
	}

	// a finished share takes no more bytes: they would go on the end of a file
	// someone may already be downloading
	if !storedFile.Pending {
		apiError(c, http.StatusConflict, ErrCodeUploadFinished, "the upload is already finished")
		return nil, false
	}

	return &storedFile, true
}

// sanitizeShare holds the parts of an upload that arrive as text to what this
// server accepts, whether the file came in one request or in pieces.
func sanitizeShare(storedFile *database.StoredFile) {
	storedFile.Filename = sanitizeFilename(storedFile.Filename)
	storedFile.Type = sanitizeType(storedFile.Type)
	storedFile.AllowedCountries = sanitizeCountries(storedFile.AllowedCountries)

	if storedFile.AllowedCountries != "" {
		storedFile.OnlyEEA = false
		storedFile.IncludeOther = false
	}

	if storedFile.Type != "image" {
		storedFile.Ephemeral = 0
	}
}

// newShareNames draws the storage name, the id in the link and the owner token.
func (s *Server) newShareNames(c *gin.Context) (name, fileId, ownerToken string, err error) {
	generated, err := uuid.NewV4()
	if err != nil {
		log.Printf("Failed to create uuid: %s\n", err)
		apiError(c, http.StatusInternalServerError, ErrCodeTempFilename, "failed to generate temp filename")

		return "", "", "", err
	}

	fileId, err = misc.GenToken(s.config.IDLength)
	if err != nil {
		log.Printf("Failed to generate file ID: %s\n", err)
		apiError(c, http.StatusInternalServerError, ErrCodeFileIDFailed, "failed to generate file ID")

		return "", "", "", err
	}

	ownerToken, err = misc.GenToken(OwnerTokenLen)
	if err != nil {
		log.Printf("Failed to generate owner token: %s\n", err)
		apiError(c, http.StatusInternalServerError, ErrCodeOwnerTokenFailed, "failed to generate owner token")

		return "", "", "", err
	}

	return generated.String(), fileId, ownerToken, nil
}

// createShare writes the row a share needs and hands back what identifies it.
// The bytes are the caller's business: an upload in one request saves them
// straight away, one in pieces appends to the file the name points at.
func (s *Server) createShare(c *gin.Context, storedFile *database.StoredFile) (*database.StoredFile, error) {
	sanitizeShare(storedFile)

	// nothing is downloadable before its bytes are all there, so the row starts
	// out pending whether the file comes in one request or in pieces
	storedFile.Pending = true

	name, fileId, ownerToken, err := s.newShareNames(c)
	if err != nil {
		return nil, err
	}

	storedFile.Name = name
	storedFile.FileId = fileId
	storedFile.OwnerToken = ownerToken

	storedFile.SrcClient = s.getClientInfo(c)
	if storedFile.SrcClient == nil {
		if !c.IsAborted() {
			apiError(c, http.StatusForbidden, ErrCodeTLSRequirements, "TLS requirements not met")
		}

		return nil, errors.New("client info rejected")
	}

	if err := s.db.Create(storedFile).Error; err != nil {
		log.Printf("Failed to create file in database: %s\n", err)
		apiError(c, http.StatusInternalServerError, ErrCodeStoreFailed, "failed to store file in database")

		return nil, err
	}

	return storedFile, nil
}

// abandonShare drops a share whose bytes never made it, so a failed start
// leaves nothing behind.
func (s *Server) abandonShare(storedFile *database.StoredFile) {
	if err := s.db.Unscoped().Delete(storedFile).Error; err != nil {
		log.Printf("Failed to drop share %s: %s\n", storedFile.FileId, err)
	}
}
