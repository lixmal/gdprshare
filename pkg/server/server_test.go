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
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

// setupTestServer creates a test server with an in-memory SQLite database
func setupTestServer(t *testing.T) (*Server, func()) {
	t.Helper()

	tempDir, err := os.MkdirTemp("", "gdprshare-test-*")
	require.NoError(t, err)

	conf := config.Default()
	conf.Database.Driver = "sqlite3"
	conf.Database.Args = ":memory:"
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

	err = writer.WriteField("type", "text/plain")
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
	assert.Equal(t, "text/plain", downloadW.Header().Get("X-Type"))
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
