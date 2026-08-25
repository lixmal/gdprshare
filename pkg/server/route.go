package server

import (
	"crypto/subtle"
	"crypto/tls"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jinzhu/gorm"
	"gopkg.in/gomail.v2"

	"github.com/lixmal/gdprshare/pkg/database"
	"github.com/lixmal/gdprshare/pkg/geoip"
	"github.com/lixmal/gdprshare/pkg/misc"
)

func (s *Server) index(c *gin.Context) {
	c.File(IndexFile)
}

// The client renders the upload limits and the footer's account of what this
// server keeps from this, so it states what the operator configured rather than
// what the code can do in principle.
func (s *Server) getConfig(c *gin.Context) {
	c.JSON(
		http.StatusOK,
		gin.H{
			"maxFileSize":     s.config.MaxUploadSize,
			"showCountdown":   s.config.ShowCountdown,
			"maxExpiry":       MaxExpiryDays,
			"maxCount":        MaxDownloadCount,
			"saveClientInfo":  s.config.SaveClientInfo,
			"reportRetention": int(misc.StatsRetention.Hours() / 24),
			"geoIP":           s.config.GeoIPPath != "",
			"privacyUrl":      s.config.PrivacyURL,
			"imprintUrl":      s.config.ImprintURL,
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
		apiError(c, http.StatusBadRequest, ErrCodeInvalidUpload, err.Error())
		return
	}

	created, err := s.createShare(c, &storedFile)
	if err != nil {
		return
	}

	path := filepath.Join(s.config.StorePath, created.Name)
	if err := c.SaveUploadedFile(created.File, path); err != nil {
		log.Printf("Failed to save file: %s\n", err)
		s.abandonShare(created)
		apiError(c, http.StatusInternalServerError, ErrCodeSaveFailed, "failed to save file")
		return
	}

	// the bytes are there, so the share can be downloaded
	created.Pending = false
	if err := s.db.Save(created).Error; err != nil {
		log.Printf("Failed to store file with id %s: %s\n", created.FileId, err)

		if err := os.Remove(path); err != nil {
			log.Printf("Failed to remove file %s: %s\n", path, err)
		}
		s.abandonShare(created)
		apiError(c, http.StatusInternalServerError, ErrCodeStoreFailed, "failed to store file in database")
		return
	}

	c.Header("Location", "/d/"+created.FileId)
	c.JSON(
		http.StatusCreated,
		gin.H{
			"message":    "file uploaded successfully",
			"fileId":     created.FileId,
			"ownerToken": created.OwnerToken,
		},
	)
}

func (s *Server) validateFiles(c *gin.Context) {
	var files []OwnedFile
	if err := c.ShouldBindJSON(&files); err != nil {
		// TODO: get FieldError and return relevant part only
		apiError(c, http.StatusBadRequest, ErrCodeInvalidRequest, err.Error())
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
			fileInfo[fileId] = storedFileInfo(&storedFile)
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
		log.Printf("Failed to retrieve file with ID %s: %s\n", fileId, err)
		return
	}

	// read before any refusal, so every attempt can be recorded and answered
	// with the same TLS requirements
	client := (*database.DstClient)(s.getClientInfo(c))
	if client == nil {
		return
	}

	// still arriving in pieces: there is no whole file to hand over, and the
	// attempt is not worth recording against a share that does not exist yet
	if storedFile.Pending {
		apiError(c, http.StatusNotFound, ErrCodeFileNotFound, "file not found")
		return
	}

	if storedFile.Count < 1 {
		s.refuse(c, storedFile, client, http.StatusNotFound, ErrCodeCountExpired, ErrCodeCountExpired, "download count expired")
		return
	}

	// The share only lives for the days it was given. The cleanup sweep runs on
	// its own interval and may be driven from outside entirely, so the expiry
	// date has to be honoured here as well.
	if time.Now().After(expiryDate(storedFile)) {
		s.refuse(c, storedFile, client, http.StatusNotFound, ErrCodeFileExpired, ErrCodeFileExpired, "file expired")
		return
	}

	path := filepath.Join(s.config.StorePath, storedFile.Name)
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		if err != nil {
			log.Printf("Failed to access file with id %s: %s\n", fileId, err)
		} else {
			log.Printf("File with id %s is a directory\n", fileId)
		}

		s.refuse(c, storedFile, client, http.StatusNotFound, ErrCodeFileNotFound, ErrCodeFileNotFound, "file not found")
		return
	}

	if time.Now().Before(storedFile.CreatedAt.Add(time.Duration(storedFile.Delay) * time.Minute)) {
		s.refuse(c, storedFile, client, http.StatusForbidden, ErrCodeNotYetDownloadble, ErrCodeNotYetDownloadble, "file not yet downloadable")
		return
	}

	// The blocklist reads the header itself: with client info turned off the
	// stored user agent is "none", which would quietly disable the check.
	blockedAgent := s.isUserAgentDisallowed(sanitizeUserAgent(c.Request.Header.Get("User-Agent")))
	if blockedAgent || !s.isDownloadAllowed(storedFile, client) {
		log.Printf("Download from %s forbidden, user agent: %s\n", client.Addr, client.UserAgent)

		reason := ErrCodeLocationForbidden
		if blockedAgent {
			reason = ErrCodeUserAgentBlocked
		}

		// a blocked user agent is not told what gave it away
		s.refuse(c, storedFile, client, http.StatusForbidden, ErrCodeLocationForbidden, reason, "download from this location forbidden")
		return
	}

	// Take the download before serving it: two requests arriving together on a
	// share with one download left must not both be served, which a read,
	// decrement and save would allow.
	taken := s.db.Model(&database.StoredFile{}).
		Where("id = ? AND count > 0", storedFile.ID).
		Update("count", gorm.Expr("count - 1"))
	if taken.Error != nil {
		log.Printf("Failed to save decreased count on file with id %s: %s\n", fileId, taken.Error)
		apiError(c, http.StatusInternalServerError, ErrCodeSaveFailed, "failed to save download count")
		return
	}
	if taken.RowsAffected == 0 {
		s.refuse(c, storedFile, client, http.StatusNotFound, ErrCodeCountExpired, ErrCodeCountExpired, "download count expired")
		return
	}
	storedFile.Count--

	record := *client
	record.StoredFileId = storedFile.ID
	if err := s.db.Create(&record).Error; err != nil {
		log.Printf("Failed to record the download of file with id %s: %s\n", fileId, err)
	}

	filename := storedFile.Filename
	if filename == "" {
		filename = storedFile.Name
	}
	c.Header("X-Filename", filename)
	c.Header("X-Type", storedFile.Type)
	c.Header("X-Ephemeral", strconv.FormatUint(uint64(storedFile.Ephemeral), 10))
	c.FileAttachment(path, filename)

	if storedFile.Count < 1 {
		// Remove actual file only, db entry will be deleted on confirmation
		if err := os.Remove(path); err != nil {
			log.Printf("Failed to delete file with id %s from storage: %s\n", fileId, err)
		}
	}

	s.notify(storedFile, client, true)
}

// refuse answers a download attempt that will not go through. The attempt is
// kept for the owner to see and, when they asked for mail, sent to them; the
// recorded reason is not always the code the requester is told.
func (s *Server) refuse(
	c *gin.Context,
	storedFile *database.StoredFile,
	client *database.DstClient,
	status int,
	sent, recorded ErrorCode,
	message string,
) {
	// the record is capped, and the notification follows it: a link someone
	// keeps hammering must not turn into an unbounded stream of mail
	if s.recordAttempt(storedFile, client, recorded) {
		s.notify(storedFile, client, false)
	}

	apiError(c, status, sent, message)
}

// notify tells the owner about an attempt, if they left an address.
func (s *Server) notify(storedFile *database.StoredFile, client *database.DstClient, allowed bool) {
	if storedFile.Email == "" {
		return
	}

	if err := s.sendMail(s.config.Mail.Subject, storedFile, client, allowed); err != nil {
		log.Printf("Failed to send access mail for ID %s: %s\n", storedFile.FileId, err)
	}
}

func (s *Server) isDownloadAllowed(storedFile *database.StoredFile, client *database.DstClient) bool {
	if storedFile.AllowedCountries != "" {
		loc := client.Location
		if loc == nil || loc.CountryCode == "" {
			return false
		}
		return isCountryInList(loc.CountryCode, storedFile.AllowedCountries)
	}

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

func isCountryInList(code, csvList string) bool {
	for _, c := range strings.Split(csvList, ",") {
		if c == code {
			return true
		}
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

// ownsFile reports whether the caller proved it is the owner of the share, and
// answers the request itself when it did not. Compared in constant time: the
// token is the only thing standing between a passer-by and someone else's
// share.
func (s *Server) ownsFile(c *gin.Context, storedFile *database.StoredFile, token string) bool {
	if subtle.ConstantTimeCompare([]byte(token), []byte(storedFile.OwnerToken)) != 1 {
		apiError(c, http.StatusUnauthorized, ErrCodeOwnerTokenMismatch, "owner token doesn't match")

		return false
	}

	return true
}

func (s *Server) confirmReceipt(c *gin.Context) {
	fileId, err := bindFileID(c)
	if err != nil {
		return
	}

	storedFile, err := s.getStoredFile(fileId, c)
	if err != nil {
		log.Printf("Failed to retrieve file with ID %s: %s\n", fileId, err)
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
		if client != nil {
			if err := s.sendMail(s.config.Mail.SubjectReceipt, storedFile, client, true); err != nil {
				log.Printf("Failed to send confirmation mail for ID %s: %s\n", fileId, err)
			}
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
		apiError(c, http.StatusBadRequest, ErrCodeInvalidRequest, err.Error())
		return
	}

	var storedFile database.StoredFile
	if err := s.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error; err != nil {
		log.Printf("Failed to find file with id %s in database: %s\n", fileId, err)
		apiError(c, http.StatusNotFound, ErrCodeFileNotFound, "file not found")
		return
	}

	if !s.ownsFile(c, &storedFile, o.OwnerToken) {
		return
	}

	if errs := misc.DeleteStoredFile(&storedFile, s.db, s.config); len(errs) > 0 {
		for _, err := range errs {
			log.Printf("%s\n", err)
		}
		apiError(c, http.StatusInternalServerError, ErrCodeDeleteFailed, "file deletion failed")
		return
	}

	c.JSON(
		http.StatusOK,
		gin.H{
			"message": "file deleted",
		},
	)
}

// prolongFile extends the expiry date and/or the remaining download count of a
// file, up to the limits that apply to a fresh upload. Requires the owner token.
func (s *Server) prolongFile(c *gin.Context) {
	fileId, err := bindFileID(c)
	if err != nil {
		return
	}

	var p ProlongRequest
	if err := c.ShouldBind(&p); err != nil {
		// TODO: get FieldError and return relevant part only
		apiError(c, http.StatusBadRequest, ErrCodeInvalidRequest, err.Error())
		return
	}

	if p.Days == 0 && p.Count == 0 {
		apiError(c, http.StatusBadRequest, ErrCodeInvalidRequest, "neither days nor downloads given")
		return
	}

	var storedFile database.StoredFile
	if err := s.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error; err != nil {
		log.Printf("Failed to find file with id %s in database: %s\n", fileId, err)
		apiError(c, http.StatusNotFound, ErrCodeFileNotFound, "file not found")
		return
	}

	if !s.ownsFile(c, &storedFile, p.OwnerToken.OwnerToken) {
		return
	}

	if storedFile.Pending {
		apiError(c, http.StatusNotFound, ErrCodeFileNotFound, "file not found")
		return
	}

	// a file whose download count ran out is gone from storage, prolonging
	// can't bring it back
	if storedFile.Count < 1 {
		apiError(c, http.StatusConflict, ErrCodeCountExpired, "download count expired")
		return
	}

	if time.Now().After(expiryDate(&storedFile)) {
		apiError(c, http.StatusConflict, ErrCodeFileExpired, "file already expired")
		return
	}

	path := filepath.Join(s.config.StorePath, storedFile.Name)
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		if err != nil {
			log.Printf("Failed to access file with id %s: %s\n", fileId, err)
		} else {
			log.Printf("File with id %s is a directory\n", fileId)
		}

		apiError(c, http.StatusNotFound, ErrCodeFileNotFound, "file not found")
		return
	}

	maxDays, maxCount := prolongLimits(&storedFile)
	if p.Days > maxDays || p.Count > maxCount {
		apiError(
			c,
			http.StatusBadRequest,
			ErrCodeProlongLimit,
			fmt.Sprintf("at most %d more day(s) and %d more download(s) allowed", maxDays, maxCount),
		)
		return
	}

	storedFile.Expiry += p.Days
	storedFile.Count += p.Count

	if err := s.db.Save(&storedFile).Error; err != nil {
		log.Printf("Failed to prolong file with id %s: %s\n", fileId, err)
		apiError(c, http.StatusInternalServerError, ErrCodeProlongFailed, "failed to prolong file")
		return
	}

	c.JSON(
		http.StatusOK,
		gin.H{
			"message":  "file prolonged",
			"fileInfo": storedFileInfo(&storedFile),
		},
	)
}

func (s *Server) setStats(c *gin.Context) {
	var stats database.Stats
	if err := c.ShouldBind(&stats); err != nil {
		// TODO: get FieldError and return relevant part only
		apiError(c, http.StatusBadRequest, ErrCodeInvalidRequest, err.Error())
		return
	}

	if s.config.SaveClientInfo {
		stats.Client = s.getClientInfo(c)
		if stats.Client == nil {
			return
		}
	}

	// Anyone can post here, so the table is bounded. A dropped report is not an
	// error the reporter can do anything about, and the answer stays the same.
	if s.statsFull() {
		c.JSON(
			http.StatusOK,
			gin.H{
				"message": "stats saved",
			},
		)

		return
	}

	if err := s.db.Save(&stats).Error; err != nil {
		log.Printf("Failed to store stats: %s\n", err)
		apiError(c, http.StatusInternalServerError, ErrCodeStatsFailed, "failed to store stats")
		return
	}

	c.JSON(
		http.StatusOK,
		gin.H{
			"message": "stats saved",
		},
	)
}

// statsFull reports whether the error reports have reached their cap. An
// unreadable table counts as full: a report is worth less than a database
// growing unchecked.
func (s *Server) statsFull() bool {
	var stored int
	if err := s.db.Model(&database.Stats{}).Count(&stored).Error; err != nil {
		log.Printf("Failed to count stats: %s\n", err)
		return true
	}

	return stored >= MaxStatsRecords
}

func (s *Server) getClientInfo(c *gin.Context) *database.Client {
	var addr, ua, tlsversion, tlscipher string
	var location *geoip.Location
	var err error

	if s.config.SaveClientInfo {
		addr = c.ClientIP()
		ua = sanitizeUserAgent(c.Request.Header.Get("User-Agent"))

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

	if err := s.validateTLS(tlsversion, tlscipher); err != nil {
		apiError(c, http.StatusForbidden, ErrCodeTLSRequirements, "TLS requirements not met")
		c.Abort()
		return nil
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
		apiError(c, http.StatusNotFound, ErrCodeFileGone, "file not found or download limit exceeded")
		return nil, fmt.Errorf("find file in database: %w", err)
	}

	var srcclient database.Client
	if err := s.db.Model(&storedFile).Related(&srcclient).Error; err != nil {
		apiError(c, http.StatusNotFound, ErrCodeRetrievalFailed, "file retrieval error")
		return nil, fmt.Errorf("access src client: %w", err)
	}
	storedFile.SrcClient = &srcclient

	var dstclients []*database.DstClient
	if err := s.db.Model(&storedFile).Related(&dstclients).Error; err != nil {
		apiError(c, http.StatusNotFound, ErrCodeRetrievalFailed, "file retrieval error")
		return nil, fmt.Errorf("access dst clients: %w", err)
	}
	storedFile.DstClients = dstclients

	return &storedFile, nil
}

func bindFileID(c *gin.Context) (string, error) {
	var f FileId
	// TODO: get FieldError and return relevant part only
	if err := c.ShouldBindUri(&f); err != nil {
		apiError(c, http.StatusBadRequest, ErrCodeInvalidFileID, err.Error())
		return "", err
	}
	return f.FileId, nil
}

// downloadRecords answers with what was recorded about each download of a
// share. Only the owner token opens it, and it reports what the server actually
// stored: with client info turned off that is the time and the encryption, and
// nothing about the person.
func (s *Server) downloadRecords(c *gin.Context) {
	fileId, err := bindFileID(c)
	if err != nil {
		return
	}

	var o OwnerToken
	if err := c.ShouldBind(&o); err != nil {
		// TODO: get FieldError and return relevant part only
		apiError(c, http.StatusBadRequest, ErrCodeInvalidRequest, err.Error())
		return
	}

	var storedFile database.StoredFile
	if err := s.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error; err != nil {
		log.Printf("Failed to find file with id %s in database: %s\n", fileId, err)
		apiError(c, http.StatusNotFound, ErrCodeFileNotFound, "file not found")
		return
	}

	if !s.ownsFile(c, &storedFile, o.OwnerToken) {
		return
	}

	var clients []*database.DstClient
	if err := s.db.Model(&storedFile).Related(&clients).Error; err != nil {
		log.Printf("Failed to read download records for id %s: %s\n", fileId, err)
		apiError(c, http.StatusNotFound, ErrCodeRetrievalFailed, "file retrieval error")
		return
	}

	records := make([]DownloadRecord, 0, len(clients))
	countries := make(map[string]string, len(clients))
	for _, client := range clients {
		records = append(records, DownloadRecord{
			Time:       client.CreatedAt,
			Denied:     client.Denied,
			Reason:     client.Reason,
			Address:    client.Addr,
			UserAgent:  client.UserAgent,
			Client:     userAgentName(client.UserAgent),
			TLSVersion: tlsVersionName(client.TLSVersion),
			TLSCipher:  tlsCipherName(client.TLSCipherSuite),
			Location:   s.locationOf(client.Addr, countries),
		})
	}

	c.JSON(
		http.StatusOK,
		gin.H{
			"downloads": records,
		},
	)
}

// recordAttempt keeps a refused download with the share it was aimed at, so its
// owner sees the attempt and the reason. Capped: a blocked link can be hit as
// often as someone likes, and the share must not grow without end.
// recordAttempt keeps a refused attempt for the owner to see and reports
// whether it was kept. The number of refusals per share is capped: a link
// someone keeps trying must not grow the database without end.
func (s *Server) recordAttempt(storedFile *database.StoredFile, client *database.DstClient, reason ErrorCode) bool {
	var denied int
	if err := s.db.Model(&database.DstClient{}).
		Where("stored_file_id = ? AND denied = ?", storedFile.ID, true).
		Count(&denied).Error; err != nil {
		log.Printf("Failed to count refused attempts for id %s: %s\n", storedFile.FileId, err)
		return false
	}

	if denied >= MaxDeniedRecords {
		return false
	}

	attempt := *client
	attempt.StoredFileId = storedFile.ID
	attempt.Denied = true
	attempt.Reason = string(reason)

	if err := s.db.Create(&attempt).Error; err != nil {
		log.Printf("Failed to record a refused attempt for id %s: %s\n", storedFile.FileId, err)
		return false
	}

	return true
}

// The stored values come either from the TLS connection, as decimal numbers, or
// from a reverse proxy header, which is already text. A number is named, and
// anything else is passed through as it was recorded.
func tlsVersionName(stored string) string {
	value, err := strconv.ParseUint(stored, 10, 16)
	if err != nil {
		return stored
	}

	return tls.VersionName(uint16(value))
}

func tlsCipherName(stored string) string {
	value, err := strconv.ParseUint(stored, 10, 16)
	if err != nil {
		return stored
	}

	return tls.CipherSuiteName(uint16(value))
}

// Where a download came from, as far as the local database can tell: city,
// region and country, since a refused attempt is worth looking at closely. Empty when no
// database is configured or the address was never stored.
func (s *Server) locationOf(addr string, seen map[string]string) string {
	if s.config.GeoIPPath == "" || addr == "" {
		return ""
	}

	// the same address usually appears more than once in a record, and every
	// lookup opens the database file
	if country, ok := seen[addr]; ok {
		return country
	}

	place := ""
	if location, err := geoip.LookupIP(s.config.GeoIPPath, addr); err == nil && location != nil {
		parts := make([]string, 0, 3)
		for _, part := range []string{location.City, location.Subdivision1, location.Country} {
			if part != "" {
				parts = append(parts, part)
			}
		}
		place = strings.Join(parts, ", ")
	}
	seen[addr] = place

	return place
}

func expiryDate(f *database.StoredFile) time.Time {
	return f.CreatedAt.AddDate(0, 0, int(f.Expiry))
}

// prolongLimits returns how many days and downloads may still be added to the
// file without pushing it past the limits of a fresh upload.
func prolongLimits(f *database.StoredFile) (days, count uint) {
	remaining := int(math.Ceil(time.Until(expiryDate(f)).Hours() / 24))
	if remaining < MaxExpiryDays {
		if remaining < 0 {
			remaining = 0
		}
		days = uint(MaxExpiryDays - remaining)
	}
	if f.Count < MaxDownloadCount {
		count = MaxDownloadCount - f.Count
	}

	return days, count
}

func storedFileInfo(f *database.StoredFile) StoredFileInfo {
	maxDays, maxCount := prolongLimits(f)

	return StoredFileInfo{
		ExpiryDate:      expiryDate(f),
		Count:           f.Count,
		MaxProlongDays:  maxDays,
		MaxProlongCount: maxCount,
	}
}
