package server

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// errorResponse is what clients parse: the stable code drives the translated
// message, the English message is the fallback for codes they don't know.
type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func decodeError(t *testing.T, w *httptest.ResponseRecorder) errorResponse {
	t.Helper()

	var resp errorResponse
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	return resp
}

// TestDownloadErrorsCarryCodes covers the errors a visitor can actually hit on
// a download link. Without a code the client cannot translate them and falls
// back to English, so each of these is a user visible regression.
func TestDownloadErrorsCarryCodes(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	tests := []struct {
		name   string
		fileId string
		status int
		code   ErrorCode
	}{
		{
			// an unknown id is rejected while looking the record up, before
			// the handler gets to distinguish missing from exhausted
			name:   "unknown file",
			fileId: "doesnotexist",
			status: http.StatusNotFound,
			code:   ErrCodeFileGone,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+tc.fileId, nil)
			w := httptest.NewRecorder()

			srv.Handler.ServeHTTP(w, req)

			assert.Equal(t, tc.status, w.Code)

			resp := decodeError(t, w)
			assert.Equal(t, string(tc.code), resp.Code, "error code for %s", tc.name)
			// the human readable message must stay, older clients still show it
			assert.NotEmpty(t, resp.Message, "fallback message for %s", tc.name)
		})
	}
}

// TestDelayedDownloadErrorCode pins the code for a file that is not yet
// downloadable, one of the messages a recipient sees most often.
func TestDelayedDownloadErrorCode(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, _ := uploadTestFile(t, srv, map[string]string{"delay": "1"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	w := httptest.NewRecorder()

	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)

	resp := decodeError(t, w)
	assert.Equal(t, string(ErrCodeNotYetDownloadble), resp.Code, "delayed download error code")
	assert.Equal(t, "file not yet downloadable", resp.Message, "english fallback message")
}

// TestDownloadCountExpiredErrorCode drains a file's download budget and checks
// the exhausted response is identifiable.
func TestDownloadCountExpiredErrorCode(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, _ := uploadTestFile(t, srv, map[string]string{"count": "1"})

	// first download consumes the only allowed count
	req := httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/files/"+fileId, nil)
	w = httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)

	resp := decodeError(t, w)
	assert.Equal(t, string(ErrCodeCountExpired), resp.Code, "exhausted download error code")
}

// TestErrorCodesAreUnique guards against a copy paste mistake giving two
// different failures the same code, which would show the wrong translation.
func TestErrorCodesAreUnique(t *testing.T) {
	codes := []ErrorCode{
		ErrCodeInvalidUpload,
		ErrCodeTempFilename,
		ErrCodeFileIDFailed,
		ErrCodeOwnerTokenFailed,
		ErrCodeTransactionStart,
		ErrCodeStoreFailed,
		ErrCodeSaveFailed,
		ErrCodeInvalidFileID,
		ErrCodeCountExpired,
		ErrCodeFileNotFound,
		ErrCodeNotYetDownloadble,
		ErrCodeLocationForbidden,
		ErrCodeFileGone,
		ErrCodeRetrievalFailed,
		ErrCodeOwnerTokenMismatch,
		ErrCodeDeleteFailed,
		ErrCodeTLSRequirements,
		ErrCodeRateLimited,
		ErrCodeInvalidRequest,
		ErrCodeStatsFailed,
	}

	seen := make(map[ErrorCode]bool, len(codes))
	for _, code := range codes {
		assert.NotEmpty(t, string(code), "error code constant must not be empty")
		assert.False(t, seen[code], "duplicate error code %q", code)
		seen[code] = true
	}
}

// uploadTestFile uploads a small file with the given extra form fields and
// returns its id and owner token.
func uploadTestFile(t *testing.T, srv *Server, fields map[string]string) (string, string) {
	t.Helper()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", "test-codes.txt")
	require.NoError(t, err)
	_, err = part.Write([]byte("test content"))
	require.NoError(t, err)

	for name, value := range fields {
		require.NoError(t, writer.WriteField(name, value))
	}
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/files", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()

	srv.Handler.ServeHTTP(w, req)
	require.Equal(t, http.StatusCreated, w.Code)

	var resp map[string]interface{}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	fileId, ok := resp["fileId"].(string)
	require.True(t, ok, "upload response has no fileId: %v", resp)

	ownerToken, ok := resp["ownerToken"].(string)
	require.True(t, ok, "upload response has no ownerToken: %v", resp)

	return fileId, ownerToken
}
