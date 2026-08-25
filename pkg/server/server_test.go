package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

// setupTestServer creates a test server with an in-memory SQLite database
func setupTestServer(t *testing.T) (*Server, func()) {
	return newTestServer(t, ":memory:")
}

// setupConcurrentTestServer creates a test server backed by a database file. An
// in-memory database belongs to the connection that opened it, so requests
// running at the same time would each find an empty one.
func setupConcurrentTestServer(t *testing.T) (*Server, func()) {
	t.Helper()

	dir, err := os.MkdirTemp("", "gdprshare-test-db-*")
	require.NoError(t, err)
	t.Cleanup(func() { os.RemoveAll(dir) })

	return newTestServer(t, filepath.Join(dir, "test.db"))
}

func newTestServer(t *testing.T, dbArgs string) (*Server, func()) {
	t.Helper()

	tempDir, err := os.MkdirTemp("", "gdprshare-test-*")
	require.NoError(t, err)

	conf := config.Default()
	conf.Database.Driver = "sqlite3"
	conf.Database.Args = dbArgs
	conf.StorePath = tempDir
	conf.SaveClientInfo = false
	conf.MaxUploadSize = 100
	conf.IDLength = 20

	db, err := database.New(conf)
	require.NoError(t, err)

	srv := New(db, conf)

	cleanup := func() {
		db.Close()
		os.RemoveAll(tempDir)
	}

	return srv, cleanup
}

// TestGetConfig verifies that the server returns correct configuration
func TestGetConfig(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	w := httptest.NewRecorder()

	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	assert.Contains(t, resp, "maxFileSize")
}

// TestUploadFile tests the basic file upload functionality
func TestUploadFile(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", "test.txt")
	require.NoError(t, err)

	testContent := []byte("Hello, World!")
	_, err = part.Write(testContent)
	require.NoError(t, err)

	err = writer.WriteField("type", "text/plain")
	require.NoError(t, err)
	err = writer.WriteField("filename", "test.txt")
	require.NoError(t, err)
	err = writer.WriteField("expiry", "7")
	require.NoError(t, err)
	err = writer.WriteField("count", "3")
	require.NoError(t, err)

	err = writer.Close()
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)

	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	assert.Contains(t, resp, "fileId")
	assert.Contains(t, resp, "ownerToken")
	if resp["fileId"] != nil {
		assert.NotEmpty(t, resp["fileId"])
	}
	if resp["ownerToken"] != nil {
		assert.NotEmpty(t, resp["ownerToken"])
	}
}

// TestUploadDownloadFlow tests the complete upload and download flow
func TestUploadDownloadFlow(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", "test-download.txt")
	require.NoError(t, err)

	testContent := []byte("Test content for download")
	_, err = part.Write(testContent)
	require.NoError(t, err)

	err = writer.WriteField("type", "text")
	require.NoError(t, err)
	err = writer.WriteField("filename", "test-download.txt")
	require.NoError(t, err)

	err = writer.Close()
	require.NoError(t, err)

	uploadReq := httptest.NewRequest(http.MethodPost, "/api/v1/files", body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(uploadW, uploadReq)

	require.Equal(t, http.StatusCreated, uploadW.Code)

	var uploadResp map[string]interface{}
	require.NoError(t, json.NewDecoder(uploadW.Body).Decode(&uploadResp))

	fileId := uploadResp["fileId"].(string)
	require.NotEmpty(t, fileId)

	downloadReq := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	downloadW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(downloadW, downloadReq)

	assert.Equal(t, http.StatusOK, downloadW.Code)

	downloadedContent, err := io.ReadAll(downloadW.Body)
	require.NoError(t, err)

	assert.Equal(t, testContent, downloadedContent, "Downloaded content should match uploaded content")

	assert.Equal(t, "test-download.txt", downloadW.Header().Get("X-Filename"))
	assert.Equal(t, "text", downloadW.Header().Get("X-Type"))
	assert.Equal(t, "0", downloadW.Header().Get("X-Ephemeral"))
}

// TestDownloadCountDecrement verifies that download count decreases correctly
func TestDownloadCountDecrement(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", "test-count.txt")
	require.NoError(t, err)
	_, err = part.Write([]byte("test"))
	require.NoError(t, err)

	err = writer.WriteField("count", "2")
	require.NoError(t, err)

	err = writer.Close()
	require.NoError(t, err)

	uploadReq := httptest.NewRequest(http.MethodPost, "/api/v1/files", body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(uploadW, uploadReq)

	var uploadResp map[string]interface{}
	require.NoError(t, json.NewDecoder(uploadW.Body).Decode(&uploadResp))
	fileId := uploadResp["fileId"].(string)

	downloadReq1 := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	downloadW1 := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW1, downloadReq1)
	assert.Equal(t, http.StatusOK, downloadW1.Code)

	downloadReq2 := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	downloadW2 := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW2, downloadReq2)
	assert.Equal(t, http.StatusOK, downloadW2.Code)

	downloadReq3 := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	downloadW3 := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW3, downloadReq3)
	assert.Equal(t, http.StatusNotFound, downloadW3.Code)
}

// TestDeleteFile tests file deletion with owner token
func TestDeleteFile(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", "test-delete.txt")
	require.NoError(t, err)
	_, err = part.Write([]byte("test delete"))
	require.NoError(t, err)

	err = writer.Close()
	require.NoError(t, err)

	uploadReq := httptest.NewRequest(http.MethodPost, "/api/v1/files", body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(uploadW, uploadReq)

	var uploadResp map[string]interface{}
	require.NoError(t, json.NewDecoder(uploadW.Body).Decode(&uploadResp))

	fileId := uploadResp["fileId"].(string)
	ownerToken := uploadResp["ownerToken"].(string)

	deleteReq := httptest.NewRequest(
		http.MethodDelete,
		fmt.Sprintf("/api/v1/files/%s?ownerToken=%s", fileId, ownerToken),
		nil,
	)
	deleteW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(deleteW, deleteReq)

	assert.Equal(t, http.StatusOK, deleteW.Code)

	downloadReq := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	downloadW := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW, downloadReq)
	assert.Equal(t, http.StatusNotFound, downloadW.Code)
}

// TestDeleteFileWrongToken verifies that deletion fails with wrong owner token
func TestDeleteFileWrongToken(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", "test-delete-fail.txt")
	require.NoError(t, err)
	_, err = part.Write([]byte("test"))
	require.NoError(t, err)

	err = writer.Close()
	require.NoError(t, err)

	uploadReq := httptest.NewRequest(http.MethodPost, "/api/v1/files", body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(uploadW, uploadReq)

	var uploadResp map[string]interface{}
	require.NoError(t, json.NewDecoder(uploadW.Body).Decode(&uploadResp))

	fileId := uploadResp["fileId"].(string)
	require.NotEmpty(t, fileId, "fileId should not be empty")

	deleteURL := fmt.Sprintf("/api/v1/files/%s?ownerToken=%s", fileId, "wrongtoken123")
	deleteReq := httptest.NewRequest(
		http.MethodDelete,
		deleteURL,
		nil,
	)
	deleteW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(deleteW, deleteReq)

	assert.Equal(t, http.StatusUnauthorized, deleteW.Code)
}

// TestValidateFiles tests the file validation endpoint
func TestValidateFiles(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", "test-validate.txt")
	require.NoError(t, err)
	_, err = part.Write([]byte("test validate"))
	require.NoError(t, err)

	err = writer.WriteField("expiry", "5")
	require.NoError(t, err)
	err = writer.WriteField("count", "3")
	require.NoError(t, err)

	err = writer.Close()
	require.NoError(t, err)

	uploadReq := httptest.NewRequest(http.MethodPost, "/api/v1/files", body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(uploadW, uploadReq)

	var uploadResp map[string]interface{}
	require.NoError(t, json.NewDecoder(uploadW.Body).Decode(&uploadResp))

	fileId, ok := uploadResp["fileId"].(string)
	require.True(t, ok, "fileId should be a string")
	require.NotEmpty(t, fileId)

	ownerToken, ok := uploadResp["ownerToken"].(string)
	require.True(t, ok, "ownerToken should be a string")
	require.NotEmpty(t, ownerToken)

	validatePayload := []map[string]string{
		{
			"fileId":     fileId,
			"ownerToken": ownerToken,
		},
	}

	validateBody, err := json.Marshal(validatePayload)
	require.NoError(t, err)

	validateReq := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/files/validate",
		bytes.NewReader(validateBody),
	)
	validateReq.Header.Set("Content-Type", "application/json")
	validateW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(validateW, validateReq)

	assert.Equal(t, http.StatusOK, validateW.Code)

	var validateResp map[string]interface{}
	require.NoError(t, json.NewDecoder(validateW.Body).Decode(&validateResp))

	require.Contains(t, validateResp, "fileInfo", "Response: %+v", validateResp)
	fileInfo, ok := validateResp["fileInfo"].(map[string]interface{})
	require.True(t, ok, "fileInfo should be a map")
	require.Contains(t, fileInfo, fileId)

	fileData, ok := fileInfo[fileId].(map[string]interface{})
	require.True(t, ok, "fileData should be a map")
	require.Contains(t, fileData, "count")
	assert.Equal(t, float64(3), fileData["count"])
}

// TestDownloadDelay verifies that files cannot be downloaded before delay expires
func TestDownloadDelay(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", "test-delay.txt")
	require.NoError(t, err)
	_, err = part.Write([]byte("test delay"))
	require.NoError(t, err)

	err = writer.WriteField("delay", "1")
	require.NoError(t, err)

	err = writer.Close()
	require.NoError(t, err)

	uploadReq := httptest.NewRequest(http.MethodPost, "/api/v1/files", body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(uploadW, uploadReq)

	var uploadResp map[string]interface{}
	require.NoError(t, json.NewDecoder(uploadW.Body).Decode(&uploadResp))

	fileId := uploadResp["fileId"].(string)

	downloadReq := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	downloadW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(downloadW, downloadReq)

	assert.Equal(t, http.StatusForbidden, downloadW.Code)

	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(downloadW.Body).Decode(&resp))
	assert.Equal(t, "file not yet downloadable", resp["message"])
}

// TestConfirmReceipt tests the receipt confirmation endpoint
func TestConfirmReceipt(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", "test-confirm.txt")
	require.NoError(t, err)
	_, err = part.Write([]byte("test confirm"))
	require.NoError(t, err)

	err = writer.WriteField("count", "1")
	require.NoError(t, err)

	err = writer.Close()
	require.NoError(t, err)

	uploadReq := httptest.NewRequest(http.MethodPost, "/api/v1/files", body)
	uploadReq.Header.Set("Content-Type", writer.FormDataContentType())
	uploadW := httptest.NewRecorder()

	srv.Handler.ServeHTTP(uploadW, uploadReq)

	var uploadResp map[string]interface{}
	require.NoError(t, json.NewDecoder(uploadW.Body).Decode(&uploadResp))

	fileId := uploadResp["fileId"].(string)

	downloadReq := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	downloadW := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW, downloadReq)
	require.Equal(t, http.StatusOK, downloadW.Code)

	confirmReq := httptest.NewRequest(http.MethodPost, "/api/v1/files/"+fileId, nil)
	confirmW := httptest.NewRecorder()
	srv.Handler.ServeHTTP(confirmW, confirmReq)

	time.Sleep(100 * time.Millisecond)

	var storedFile database.StoredFile
	err = srv.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error
	assert.Error(t, err, "File should be deleted from database after confirmation")
}

// TestFileNotFound verifies proper handling of non-existent files
func TestFileNotFound(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/files/nonexistent123", nil)
	w := httptest.NewRecorder()

	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

// TestSetStats tests the stats collection endpoint
func TestSetStats(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	statsPayload := map[string]string{
		"url": "https://example.com/test",
	}

	statsBody, err := json.Marshal(statsPayload)
	require.NoError(t, err)

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/stats",
		bytes.NewReader(statsBody),
	)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Equal(t, "stats saved", resp["message"])
}

// TestIndexRoute verifies that the index route serves the HTML file
func TestIndexRoute(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	tempIndex := filepath.Join("public", "index.html")
	err := os.MkdirAll("public", 0755)
	require.NoError(t, err)
	defer os.RemoveAll("public")

	err = os.WriteFile(tempIndex, []byte("<html><body>Test</body></html>"), 0644)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "Test")
}

func prolong(t *testing.T, srv *Server, fileId, ownerToken, days, count string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(
		http.MethodPost,
		fmt.Sprintf("/api/v1/files/%s/prolong?ownerToken=%s&days=%s&count=%s", fileId, ownerToken, days, count),
		nil,
	)
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	return w
}

// TestProlongFile verifies that expiry and download count are extended
func TestProlongFile(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{
		"expiry": "2",
		"count":  "1",
	})

	w := prolong(t, srv, fileId, ownerToken, "5", "3")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp struct {
		FileInfo StoredFileInfo `json:"fileInfo"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	assert.Equal(t, uint(4), resp.FileInfo.Count)
	// 2 + 5 days from creation, and the remaining room up to the maximum
	assert.WithinDuration(t, time.Now().AddDate(0, 0, 7), resp.FileInfo.ExpiryDate, time.Minute)
	assert.Equal(t, uint(7), resp.FileInfo.MaxProlongDays)
	assert.Equal(t, uint(11), resp.FileInfo.MaxProlongCount)

	var storedFile database.StoredFile
	require.NoError(t, srv.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error)
	assert.Equal(t, uint(7), storedFile.Expiry)
	assert.Equal(t, uint(4), storedFile.Count)

	// the added downloads are actually usable
	for i := 0; i < 4; i++ {
		downloadW := httptest.NewRecorder()
		srv.Handler.ServeHTTP(downloadW, httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil))
		assert.Equal(t, http.StatusOK, downloadW.Code, "download %d", i+1)
	}

	downloadW := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW, httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil))
	assert.Equal(t, http.StatusNotFound, downloadW.Code)
}

// TestProlongFileWrongToken verifies that prolonging needs the owner token
func TestProlongFileWrongToken(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, _ := uploadTestFile(t, srv, nil)

	w := prolong(t, srv, fileId, "wrongtoken123", "1", "0")
	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var storedFile database.StoredFile
	require.NoError(t, srv.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error)
	assert.Equal(t, uint(14), storedFile.Expiry)
}

// TestProlongFileLimits verifies that the upload limits also bound prolonging
func TestProlongFileLimits(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{
		"expiry": "10",
		"count":  "5",
	})

	// 10 + 5 days exceeds the 14 day maximum
	w := prolong(t, srv, fileId, ownerToken, "5", "0")
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// 5 + 11 downloads exceeds the maximum of 15
	w = prolong(t, srv, fileId, ownerToken, "0", "11")
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// nothing to do
	w = prolong(t, srv, fileId, ownerToken, "0", "0")
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// within the limits
	w = prolong(t, srv, fileId, ownerToken, "4", "10")
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
}

// TestProlongFileExhausted verifies that a file without downloads left can't be revived
func TestProlongFileExhausted(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{
		"count": "1",
	})

	downloadReq := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	downloadW := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW, downloadReq)
	require.Equal(t, http.StatusOK, downloadW.Code)

	w := prolong(t, srv, fileId, ownerToken, "1", "1")
	assert.Equal(t, http.StatusConflict, w.Code)
}

// TestConfigReportsWhatTheFooterStates covers the fields the client's footer
// builds its account of stored data from: it has to follow the operator's
// configuration, not the code's capabilities.
func TestConfigReportsWhatTheFooterStates(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	srv.config.SaveClientInfo = true
	srv.config.PrivacyURL = "https://example.org/privacy"
	srv.config.ImprintURL = ""

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	assert.Equal(t, true, resp["saveClientInfo"])
	assert.Equal(t, false, resp["geoIP"], "no GeoIP path is configured")
	assert.Equal(t, "https://example.org/privacy", resp["privacyUrl"])
	assert.Equal(t, "", resp["imprintUrl"])
	// the upload limits come from the same place the prolong bounds do
	assert.Equal(t, float64(MaxExpiryDays), resp["maxExpiry"])
	assert.Equal(t, float64(MaxDownloadCount), resp["maxCount"])
}

func downloadRecords(t *testing.T, srv *Server, fileId, ownerToken string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(
		http.MethodPost,
		fmt.Sprintf("/api/v1/files/%s/downloads?ownerToken=%s", fileId, ownerToken),
		nil,
	)
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	return w
}

// TestDownloadRecords reports one entry per download, which is the same
// material the notification mail carries.
func TestDownloadRecords(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{"count": "3"})

	w := downloadRecords(t, srv, fileId, ownerToken)
	require.Equal(t, http.StatusOK, w.Code)

	var empty struct {
		Downloads []DownloadRecord `json:"downloads"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&empty))
	assert.Empty(t, empty.Downloads, "nothing was downloaded yet")

	for i := 0; i < 2; i++ {
		downloadW := httptest.NewRecorder()
		srv.Handler.ServeHTTP(downloadW, httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil))
		require.Equal(t, http.StatusOK, downloadW.Code)
	}

	w = downloadRecords(t, srv, fileId, ownerToken)
	require.Equal(t, http.StatusOK, w.Code)

	var resp struct {
		Downloads []DownloadRecord `json:"downloads"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	require.Len(t, resp.Downloads, 2)
	assert.WithinDuration(t, time.Now(), resp.Downloads[0].Time, time.Minute)
	// this server keeps no client info, so the person stays out of the record
	assert.Empty(t, resp.Downloads[0].Address)
	assert.Empty(t, resp.Downloads[0].Location)
}

// TestDownloadRecordsWrongToken keeps the records to the owner
func TestDownloadRecordsWrongToken(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, _ := uploadTestFile(t, srv, nil)

	w := downloadRecords(t, srv, fileId, "wrongtoken123")
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// TestTLSNamesAreReadable turns what was stored into something a person can read
func TestTLSNamesAreReadable(t *testing.T) {
	assert.Equal(t, "TLS 1.3", tlsVersionName("772"))
	assert.Equal(t, "TLS_AES_128_GCM_SHA256", tlsCipherName("4865"))
	// a reverse proxy sends text rather than numbers, and it is kept as it came
	assert.Equal(t, "TLSv1.3", tlsVersionName("TLSv1.3"))
	assert.Equal(t, "", tlsCipherName(""))
}

// TestRefusedAttemptsAreRecorded keeps every attempt with the share it was
// aimed at, with the reason it did not go through.
func TestRefusedAttemptsAreRecorded(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{
		"allowed-countries": "DE",
		"count":             "3",
	})

	// the server cannot place the client without a GeoIP database, and a
	// restriction then refuses rather than waving the download through
	downloadW := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW, httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil))
	require.Equal(t, http.StatusForbidden, downloadW.Code)

	w := downloadRecords(t, srv, fileId, ownerToken)
	require.Equal(t, http.StatusOK, w.Code)

	var resp struct {
		Downloads []DownloadRecord `json:"downloads"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	require.Len(t, resp.Downloads, 1)
	assert.True(t, resp.Downloads[0].Denied)
	assert.Equal(t, string(ErrCodeLocationForbidden), resp.Downloads[0].Reason)

	// and the refusal costs the recipient no download
	var storedFile database.StoredFile
	require.NoError(t, srv.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error)
	assert.Equal(t, uint(3), storedFile.Count)
}

// TestRefusedAttemptNamesTheUserAgent tells a blocked browser apart from a
// blocked country, which the API answer cannot do.
func TestRefusedAttemptNamesTheUserAgent(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	srv.config.DisallowedUserAgents = []string{"CrawlerBot"}
	fileId, ownerToken := uploadTestFile(t, srv, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	req.Header.Set("User-Agent", "CrawlerBot/2.0")
	downloadW := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW, req)
	require.Equal(t, http.StatusForbidden, downloadW.Code)

	w := downloadRecords(t, srv, fileId, ownerToken)
	var resp struct {
		Downloads []DownloadRecord `json:"downloads"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	require.Len(t, resp.Downloads, 1)
	assert.Equal(t, string(ErrCodeUserAgentBlocked), resp.Downloads[0].Reason)
}

// TestRefusedAttemptsAreCapped stops a blocked link from growing without end
func TestRefusedAttemptsAreCapped(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{"allowed-countries": "DE"})

	for i := 0; i < MaxDeniedRecords+5; i++ {
		w := httptest.NewRecorder()
		srv.Handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil))
		require.Equal(t, http.StatusForbidden, w.Code)
	}

	w := downloadRecords(t, srv, fileId, ownerToken)
	var resp struct {
		Downloads []DownloadRecord `json:"downloads"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	assert.Len(t, resp.Downloads, MaxDeniedRecords)
}

// TestDelayedDownloadIsRecorded covers the attempt that came too early
func TestDelayedDownloadIsRecorded(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{"delay": "10"})

	downloadW := httptest.NewRecorder()
	srv.Handler.ServeHTTP(downloadW, httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil))
	require.Equal(t, http.StatusForbidden, downloadW.Code)

	w := downloadRecords(t, srv, fileId, ownerToken)
	var resp struct {
		Downloads []DownloadRecord `json:"downloads"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))
	require.Len(t, resp.Downloads, 1)
	assert.Equal(t, string(ErrCodeNotYetDownloadble), resp.Downloads[0].Reason)
}

// TestUserAgentBlockWorksWithoutClientInfo keeps the blocklist working on a
// server that stores nothing about its visitors: the check reads the header
// rather than the record.
func TestUserAgentBlockWorksWithoutClientInfo(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	require.False(t, srv.config.SaveClientInfo, "this server keeps no client info")
	srv.config.DisallowedUserAgents = []string{"CrawlerBot"}

	fileId, ownerToken := uploadTestFile(t, srv, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	req.Header.Set("User-Agent", "CrawlerBot/2.0")
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)

	// and the attempt is recorded without naming the browser it came from
	records := downloadRecords(t, srv, fileId, ownerToken)
	var resp struct {
		Downloads []DownloadRecord `json:"downloads"`
	}
	require.NoError(t, json.NewDecoder(records.Body).Decode(&resp))
	require.Len(t, resp.Downloads, 1)
	assert.Equal(t, string(ErrCodeUserAgentBlocked), resp.Downloads[0].Reason)
	assert.Equal(t, "none", resp.Downloads[0].UserAgent)
	assert.Empty(t, resp.Downloads[0].Client, "there is no user agent to read")
}

// TestLocationLookupIsCachedPerRequest keeps the database file from being
// opened once per recorded line.
func TestLocationLookupIsCachedPerRequest(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	// no GeoIP database is configured here, so nothing is placed at all
	require.Empty(t, srv.config.GeoIPPath)

	seen := map[string]string{}
	assert.Equal(t, "", srv.locationOf("203.0.113.7", seen))
	assert.Empty(t, seen, "an unconfigured lookup caches nothing")

	// with a database configured, a repeated address is looked up once
	srv.config.GeoIPPath = "/nonexistent/GeoLite2-City.mmdb"
	assert.Equal(t, "", srv.locationOf("203.0.113.7", seen))
	require.Contains(t, seen, "203.0.113.7")
	seen["203.0.113.7"] = "Berlin, Berlin, Germany"
	assert.Equal(t, "Berlin, Berlin, Germany", srv.locationOf("203.0.113.7", seen))
}

// backdate moves a share's creation time, which is what its expiry is measured
// from.
func backdate(t *testing.T, srv *Server, fileId string, d time.Duration) {
	t.Helper()

	require.NoError(t, srv.db.Model(&database.StoredFile{}).
		Where("file_id = ?", fileId).
		Update("created_at", time.Now().Add(-d)).Error)
}

func downloadOnce(t *testing.T, srv *Server, fileId string) *httptest.ResponseRecorder {
	t.Helper()

	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil))

	return w
}

func recordsOf(t *testing.T, srv *Server, fileId, ownerToken string) []DownloadRecord {
	t.Helper()

	w := downloadRecords(t, srv, fileId, ownerToken)
	require.Equal(t, http.StatusOK, w.Code)

	var resp struct {
		Downloads []DownloadRecord `json:"downloads"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	return resp.Downloads
}

// TestDownloadRefusedAfterExpiry stops a share at its expiry date rather than
// at the next cleanup sweep, which runs on its own interval and may be driven
// from outside the server entirely.
func TestDownloadRefusedAfterExpiry(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{
		"expiry": "1",
		"count":  "5",
	})

	// still within the day it was given
	require.Equal(t, http.StatusOK, downloadOnce(t, srv, fileId).Code)

	backdate(t, srv, fileId, 3*24*time.Hour)

	w := downloadOnce(t, srv, fileId)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, string(ErrCodeFileExpired), decodeError(t, w).Code)

	// the downloads it had left are not spendable either
	var storedFile database.StoredFile
	require.NoError(t, srv.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error)
	assert.Equal(t, uint(4), storedFile.Count)

	// and the owner sees that someone tried after the share had ended
	records := recordsOf(t, srv, fileId, ownerToken)
	require.Len(t, records, 2)
	assert.True(t, records[1].Denied)
	assert.Equal(t, string(ErrCodeFileExpired), records[1].Reason)
}

// TestDownloadAttemptAfterCountRecorded keeps an attempt on a spent share: the
// owner wants to see that the link was tried again after the last download.
func TestDownloadAttemptAfterCountRecorded(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{"count": "1"})

	require.Equal(t, http.StatusOK, downloadOnce(t, srv, fileId).Code)

	w := downloadOnce(t, srv, fileId)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, string(ErrCodeCountExpired), decodeError(t, w).Code)

	records := recordsOf(t, srv, fileId, ownerToken)
	require.Len(t, records, 2)
	assert.False(t, records[0].Denied, "the download that went through")
	assert.True(t, records[1].Denied)
	assert.Equal(t, string(ErrCodeCountExpired), records[1].Reason)
}

// TestDownloadAttemptOnMissingFileRecorded covers the share whose database row
// outlived the file itself.
func TestDownloadAttemptOnMissingFileRecorded(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, ownerToken := uploadTestFile(t, srv, map[string]string{"count": "3"})

	var storedFile database.StoredFile
	require.NoError(t, srv.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error)
	require.NoError(t, os.Remove(filepath.Join(srv.config.StorePath, storedFile.Name)))

	w := downloadOnce(t, srv, fileId)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, string(ErrCodeFileNotFound), decodeError(t, w).Code)

	records := recordsOf(t, srv, fileId, ownerToken)
	require.Len(t, records, 1)
	assert.Equal(t, string(ErrCodeFileNotFound), records[0].Reason)
}

// TestConcurrentDownloadsSpendEachCountOnce holds the download count to what it
// says: requests arriving together must not each be served off the same read.
func TestConcurrentDownloadsSpendEachCountOnce(t *testing.T) {
	srv, cleanup := setupConcurrentTestServer(t)
	defer cleanup()

	fileId, _ := uploadTestFile(t, srv, map[string]string{"count": "3"})

	var mu sync.Mutex
	served := 0
	var wg sync.WaitGroup

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			w := downloadOnce(t, srv, fileId)

			mu.Lock()
			defer mu.Unlock()
			if w.Code == http.StatusOK {
				served++
			}
		}()
	}
	wg.Wait()

	assert.Equal(t, 3, served, "a share with three downloads was served three times")

	var storedFile database.StoredFile
	require.NoError(t, srv.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error)
	assert.Equal(t, uint(0), storedFile.Count)
}

// postStats reports a broken link the way the download page does.
func postStats(t *testing.T, srv *Server, url string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/stats?url="+url, nil)
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	return w
}

// TestStatsAreBounded holds the error reports to a cap. The endpoint needs no
// token, so anyone who finds it could otherwise fill the database.
func TestStatsAreBounded(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	for i := 0; i < MaxStatsRecords; i++ {
		require.NoError(t, srv.db.Create(&database.Stats{URL: "https://example.org/d/full"}).Error)
	}

	// the report is dropped, and the reporter is told nothing it could act on
	w := postStats(t, srv, "https://example.org/d/dropped")
	assert.Equal(t, http.StatusOK, w.Code)

	var stored int
	require.NoError(t, srv.db.Model(&database.Stats{}).Count(&stored).Error)
	assert.Equal(t, MaxStatsRecords, stored)
}

// TestStatsAreStoredBelowTheCap covers the ordinary report, so the cap test
// cannot pass by the endpoint being broken.
func TestStatsAreStoredBelowTheCap(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	require.Equal(t, http.StatusOK, postStats(t, srv, "https://example.org/d/broken").Code)

	var stored []database.Stats
	require.NoError(t, srv.db.Find(&stored).Error)
	require.Len(t, stored, 1)
	assert.Equal(t, "https://example.org/d/broken", stored[0].URL)
}

// TestPagesAnswerHead covers the probe a chat program or a monitor sends before
// it fetches a link. A 404 there reads as a dead link.
func TestPagesAnswerHead(t *testing.T) {
	// the handler serves IndexFile by its path relative to the working
	// directory, which is the repository root when the server runs
	t.Chdir("../..")

	srv, cleanup := setupTestServer(t)
	defer cleanup()

	for _, page := range []string{"/", "/uploaded", "/d/someshareid"} {
		w := httptest.NewRecorder()
		srv.Handler.ServeHTTP(w, httptest.NewRequest(http.MethodHead, page, nil))

		assert.Equal(t, http.StatusOK, w.Code, page)
		assert.Contains(t, w.Header().Get("Content-Type"), "text/html", page)
		// a HEAD answer carries the headers and no body
		assert.Empty(t, w.Body.String(), page)
	}
}

// TestPageHeadIsNotABlanketRoute keeps the probe from answering for paths the
// app does not serve.
func TestPageHeadIsNotABlanketRoute(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, httptest.NewRequest(http.MethodHead, "/not-a-page", nil))

	assert.Equal(t, http.StatusNotFound, w.Code)
}
