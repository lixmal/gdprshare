package server

import (
	"crypto/subtle"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/gin-gonic/gin"
	uuid "github.com/nu7hatch/gouuid"
	"gopkg.in/gomail.v2"

	"github.com/lixmal/gdprshare/pkg/database"
	"github.com/lixmal/gdprshare/pkg/geoip"
	"github.com/lixmal/gdprshare/pkg/misc"
)

func (s *Server) index(c *gin.Context) {
	c.File(IndexFile)
}

func (s *Server) getConfig(c *gin.Context) {
	c.JSON(
		http.StatusOK,
		gin.H{
			"maxFileSize": s.config.MaxUploadSize,
		},
	)
}

func (s *Server) uploadFile(c *gin.Context) {
	var storedFile database.StoredFile
	if err := c.ShouldBind(&storedFile); err != nil {
		// file too large: middleware has already written to response body
		if c.Writer.Status() == http.StatusRequestEntityTooLarge {
			return
		}
		c.JSON(
			http.StatusBadRequest,
			gin.H{
				"message": err.Error(),
			},
		)
		return
	}

	name, err := uuid.NewV4()
	if err != nil {
		log.Printf("Failed to create uuid: %s\n", err)
		c.JSON(
			http.StatusInternalServerError,
			gin.H{
				"message": "failed to generate temp filename",
			},
		)
		return
	}
	namestr := name.String()

	fileId, err := misc.GenToken(s.config.IDLength)
	if err != nil {
		log.Printf("Failed to generate file ID: %s\n", err)
		c.JSON(
			http.StatusInternalServerError,
			gin.H{
				"message": "failed to generate file ID",
			},
		)
		return
	}

	ownerToken, err := misc.GenToken(OwnerTokenLen)
	if err != nil {
		log.Printf("Failed to generate file ID: %s\n", err)
		c.JSON(
			http.StatusInternalServerError,
			gin.H{
				"message": "failed to generate owner token",
			},
		)
		return
	}

	tx := s.db.Begin()
	if err = tx.Error; err != nil {
		log.Printf("Failed to begin transaction: %s\n", err)
		c.JSON(
			http.StatusInternalServerError,
			gin.H{
				"message": "failed to start transaction",
			},
		)
		return
	}

	storedFile.FileId = fileId
	storedFile.OwnerToken = ownerToken
	storedFile.Name = namestr

	storedFile.SrcClient = s.getClientInfo(c)

	if err = tx.Create(&storedFile).Error; err != nil {
		log.Printf("Failed to create file in database: %s\n", err)
		if err = tx.Rollback().Error; err != nil {
			log.Printf("Failed to rollback: %s\n", err)
		}
		c.JSON(
			http.StatusInternalServerError,
			gin.H{
				"message": "failed to store file in database",
			},
		)
		return
	}

	path := filepath.Join(s.config.StorePath, namestr)
	if err := c.SaveUploadedFile(storedFile.File, path); err != nil {
		log.Printf("Failed to save file: %s\n", err)
		if err = tx.Rollback().Error; err != nil {
			log.Printf("Failed to rollback: %s\n", err)
		}
		c.JSON(
			http.StatusInternalServerError,
			gin.H{
				"message": "failed to save file",
			},
		)
		return
	}

	if err = tx.Commit().Error; err != nil {
		log.Printf("Failed to commit: %s\n", err)

		if err = os.Remove(path); err != nil {
			log.Printf("Failed to remove file %s: %s\n", path, err)
		}
		c.JSON(
			http.StatusInternalServerError,
			gin.H{
				"message": "failed to store file in database",
			},
		)
		return
	}

	c.Header("Location", "/d/"+fileId)
	c.JSON(
		http.StatusCreated,
		gin.H{
			"message":    "file uploaded successfully",
			"fileId":     fileId,
			"ownerToken": ownerToken,
		},
	)
}

func (s *Server) validateFiles(c *gin.Context) {
	var files []OwnedFile
	if err := c.ShouldBindJSON(&files); err != nil {
		// TODO: get FieldError and return relevant part only
		c.JSON(
			http.StatusBadRequest,
			gin.H{
				"message": err.Error(),
			},
		)
		return
	}

	fileInfo := map[string]StoredFileInfo{}
	for _, f := range files {
		var storedFile database.StoredFile

		fileId := f.FileId.FileId
		err := s.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error
		if err != nil {
			log.Printf("Failed to find file with id %s in database: %s\n", fileId, err)
			fileInfo[fileId] = StoredFileInfo{}
		} else if subtle.ConstantTimeCompare([]byte(f.OwnerToken.OwnerToken), []byte(storedFile.OwnerToken)) != 1 {
			fileInfo[fileId] = StoredFileInfo{
				Error: "Owner token mismatch",
			}
		} else {
			fileInfo[fileId] = StoredFileInfo{
				ExpiryDate: storedFile.CreatedAt.AddDate(0, 0, int(storedFile.Expiry)),
				Count:      storedFile.Count,
			}
		}
	}

	c.JSON(
		http.StatusOK,
		gin.H{
			"fileInfo": fileInfo,
		},
	)
}

func (s *Server) downloadFile(c *gin.Context) {
	fileId, err := bindFileID(c)
	if err != nil {
		return
	}

	storedFile, err := s.getStoredFile(fileId, c)
	if err != nil {
		fmt.Printf("Failed to retrieve file with ID %s: %s\n", fileId, err)
		return
	}

	path := filepath.Join(s.config.StorePath, storedFile.Name)

	if storedFile.Count < 1 {
		c.JSON(
			http.StatusNotFound,
			gin.H{
				"message": "download count expired",
			},
		)
		return
	}

	if info, err := os.Stat(path); err != nil || info.IsDir() {
		if err != nil {
			log.Printf("Failed to access file with id %s: %s\n", fileId, err)
		} else {
			log.Printf("File with id %s is a directory\n", fileId)
		}

		c.JSON(
			http.StatusNotFound,
			gin.H{
				"message": "file not found",
			},
		)
		return
	}

	client := (*database.DstClient)(s.getClientInfo(c))

	allowed := s.isDownloadAllowed(storedFile, client) && !s.isUserAgentDisallowed(client.UserAgent)

	if time.Now().Before(storedFile.CreatedAt.Add(time.Duration(storedFile.Delay) * time.Minute)) {
		c.JSON(
			http.StatusForbidden, gin.H{
				"message": "file not yet downloadable",
			},
		)
	} else if !allowed {
		log.Printf("Download from %s forbidden, user agent: %s\n", client.Addr, client.UserAgent)
		c.JSON(
			http.StatusForbidden,
			gin.H{
				"message": "download from this location forbidden",
			},
		)
	} else {
		storedFile.DstClients = append(
			storedFile.DstClients,
			client,
		)

		storedFile.Count--
		if err := s.db.Save(&storedFile).Error; err != nil {
			log.Printf("Failed to save decreased count on file with id %s: %s\n", fileId, err)
		}

		var filename string
		if storedFile.Filename != "" {
			filename = storedFile.Filename
		} else {
			filename = storedFile.Name
		}
		c.Header("X-Filename", filename)
		c.Header("X-Type", storedFile.Type)
		c.FileAttachment(path, filename)

		if storedFile.Count < 1 {
			// Remove actual file only, db entry will be deleted on confirmation
			if err := os.Remove(path); err != nil {
				log.Printf("Failed to delete file with id %s from storage: %s\n", fileId, err)
			}
		}
	}

	if storedFile.Email != "" {
		if err := s.sendMail(s.config.Mail.Subject, storedFile, client, allowed); err != nil {
			log.Printf("Failed to send access mail for ID %s: %s\n", fileId, err)
		}
	}
}

func (s *Server) isDownloadAllowed(storedFile *database.StoredFile, client *database.DstClient) bool {
	if !storedFile.OnlyEEA {
		return true
	}

	loc := client.Location
	if loc == nil {
		return false
	}

	if loc.IsEU ||
		loc.Country == "Norway" ||
		loc.Country == "Liechtenstein" ||
		loc.Country == "Iceland" {

		return true
	}

	if storedFile.IncludeOther && (loc.Country == "Switzerland" ||
		loc.Country == "United Kingdom" ||
		loc.Country == "Monaco" ||
		loc.Country == "San Marino" ||
		loc.Country == "Andorra" ||
		loc.Country == "Vatican City") {

		return true
	}

	return false
}

func (s *Server) isUserAgentDisallowed(userAgent string) bool {
	for _, disallowedUA := range s.config.DisallowedUserAgents {
		if strings.Contains(userAgent, disallowedUA) {
			return true
		}
	}
	return false
}

func (s *Server) confirmReceipt(c *gin.Context) {
	fileId, err := bindFileID(c)
	if err != nil {
		return
	}

	storedFile, err := s.getStoredFile(fileId, c)
	if err != nil {
		fmt.Printf("Failed to retrieve file with ID %s: %s\n", fileId, err)
		return
	}

	if storedFile.Count < 1 {
		// File already deleted from storage by download handler, so we're taking care of the db now
		if err := s.db.Delete(storedFile).Error; err != nil {
			log.Printf("Failed to delete file with id %s from database: %s\n", fileId, err)
		}
	}

	if storedFile.Email != "" {
		client := (*database.DstClient)(s.getClientInfo(c))
		if err := s.sendMail(s.config.Mail.SubjectReceipt, storedFile, client, true); err != nil {
			log.Printf("Failed to send confirmation mail for ID %s: %s\n", fileId, err)
		}
	}
}

func (s *Server) deleteFile(c *gin.Context) {
	fileId, err := bindFileID(c)
	if err != nil {
		return
	}

	var o OwnerToken
	if err := c.ShouldBind(&o); err != nil {
		// TODO: get FieldError and return relevant part only
		c.JSON(
			http.StatusBadRequest,
			gin.H{
				"message": err.Error(),
			},
		)
		return
	}

	var storedFile database.StoredFile
	if err := s.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error; err != nil {
		log.Printf("Failed to find file with id %s in database: %s\n", fileId, err)
		c.JSON(
			http.StatusNotFound,
			gin.H{
				"message": "file not found",
			},
		)
		return
	}

	// check if owner token matches the stored one
	if subtle.ConstantTimeCompare([]byte(o.OwnerToken), []byte(storedFile.OwnerToken)) != 1 {
		c.JSON(
			http.StatusUnauthorized,
			gin.H{
				"message": "owner token doesn't match",
			},
		)
		return
	}

	if errs := misc.DeleteStoredFile(&storedFile, s.db, s.config); len(errs) > 0 {
		for _, err := range errs {
			log.Printf("%s\n", err)
		}
		c.JSON(
			http.StatusInternalServerError,
			gin.H{
				"message": "file deletion failed",
			},
		)
		return
	}

	c.JSON(
		http.StatusOK,
		gin.H{
			"message": "file deleted",
		},
	)
}

func (s *Server) setStats(c *gin.Context) {
	var stats database.Stats
	if err := c.ShouldBind(&stats); err != nil {
		// TODO: get FieldError and return relevant part only
		c.JSON(
			http.StatusBadRequest,
			gin.H{
				"message": err.Error(),
			},
		)
		return
	}

	if s.config.SaveClientInfo {
		stats.Client = s.getClientInfo(c)
	}
	if err := s.db.Save(&stats).Error; err != nil {
		log.Printf("Failed to store stats: %s\n", err)
		c.JSON(
			http.StatusInternalServerError,
			gin.H{
				"message": "failed to store stats",
			},
		)
		return
	}

	c.JSON(
		http.StatusOK,
		gin.H{
			"message": "stats saved",
		},
	)
}

func (s *Server) getClientInfo(c *gin.Context) *database.Client {
	var addr, ua, tlsversion, tlscipher string
	var location *geoip.Location
	var err error

	if s.config.SaveClientInfo {
		addr = c.ClientIP()
		ua = c.Request.Header.Get("User-Agent")

		if s.config.GeoIPPath != "" {
			location, err = geoip.LookupIP(s.config.GeoIPPath, addr)
			if err != nil {
				log.Printf("Failed to lookup geo ip: %s\n", err)
			}
		}
	} else {
		ua = "none"
	}

	if c.Request.TLS != nil {
		tlscipher = strconv.Itoa(int(c.Request.TLS.CipherSuite))
		tlsversion = strconv.Itoa(int(c.Request.TLS.Version))
	} else {
		tlsversion = c.Request.Header.Get(s.config.Header.TLSVersion)
		tlscipher = c.Request.Header.Get(s.config.Header.TLSCipherSuite)
	}

	return &database.Client{
		Addr:           addr,
		UserAgent:      ua,
		TLSVersion:     tlsversion,
		TLSCipherSuite: tlscipher,
		Location:       location,
	}
}

func (s *Server) sendMail(subject string, storedFile *database.StoredFile, client *database.DstClient, allowedDownload bool) error {
	templ, err := template.New("mailbody").Parse(s.config.Mail.Body)
	if err != nil {
		return fmt.Errorf("parse mail body template: %w", err)
	}

	var deniedMsg string

	if !allowedDownload {
		deniedMsg = s.config.Mail.DeniedMsg
	}

	fields := struct {
		FileID            string
		Addr              string
		UserAgent         string
		SrcTLSVersion     string
		SrcTLSCipherSuite string
		DstTLSVersion     string
		DstTLSCipherSuite string
		Location          *geoip.Location
		DeniedMsg         string
	}{
		storedFile.FileId,
		client.Addr,
		client.UserAgent,
		storedFile.SrcClient.TLSVersion,
		storedFile.SrcClient.TLSCipherSuite,
		client.TLSVersion,
		client.TLSCipherSuite,
		client.Location,
		deniedMsg,
	}

	var body strings.Builder
	if err := templ.Execute(&body, fields); err != nil {
		return fmt.Errorf("execute mail body template: %w", err)
	}

	msg := gomail.NewMessage()
	msg.SetHeader("From", s.config.Mail.From)
	msg.SetHeader("To", storedFile.Email)
	msg.SetHeader(
		"Subject",
		fmt.Sprintf(
			subject,
			storedFile.FileId,
		),
	)
	msg.SetBody("text/plain", body.String())

	dialer := gomail.NewDialer(s.config.Mail.SmtpHost, int(s.config.Mail.SmtpPort), s.config.Mail.SmtpUser, s.config.Mail.SmtpPass)

	if err := dialer.DialAndSend(msg); err != nil {
		return fmt.Errorf("send mail to %s: %w", storedFile.Email, err)
	}

	return nil
}

func (s *Server) getStoredFile(fileId string, c *gin.Context) (*database.StoredFile, error) {
	var storedFile database.StoredFile

	if err := s.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error; err != nil {
		c.JSON(
			http.StatusNotFound,
			gin.H{
				"message": "file not found or download limit exceeded",
			},
		)
		return nil, fmt.Errorf("find file in database: %w", err)
	}

	var srcclient database.Client
	if err := s.db.Model(&storedFile).Related(&srcclient).Error; err != nil {
		c.JSON(
			http.StatusNotFound,
			gin.H{
				"message": "file retrieval error",
			},
		)
		return nil, fmt.Errorf("access src client: %w", err)
	}
	storedFile.SrcClient = &srcclient

	var dstclients []*database.DstClient
	if err := s.db.Model(&storedFile).Related(&dstclients).Error; err != nil {
		c.JSON(
			http.StatusNotFound,
			gin.H{
				"message": "file retrieval error",
			},
		)
		return nil, fmt.Errorf("access dst clients: %w", err)
	}
	storedFile.DstClients = dstclients

	return &storedFile, nil
}

func bindFileID(c *gin.Context) (string, error) {
	var f FileId
	// TODO: get FieldError and return relevant part only
	if err := c.ShouldBindUri(&f); err != nil {
		c.JSON(
			http.StatusBadRequest,
			gin.H{
				"message": err.Error(),
			},
		)
		return "", err
	}
	return f.FileId, nil
}
