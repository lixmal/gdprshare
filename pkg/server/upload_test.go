package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

// begin opens an upload that arrives in pieces and returns its id and token.
func begin(t *testing.T, srv *Server, fields map[string]string) (string, string) {
	t.Helper()

	form := url.Values{}
	for name, value := range fields {
		form.Set(name, value)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

	var resp struct {
		FileId     string `json:"fileId"`
		OwnerToken string `json:"ownerToken"`
	}
	require.NoError(t, json.NewDecoder(w.Body).Decode(&resp))

	return resp.FileId, resp.OwnerToken
}

func appendChunk(t *testing.T, srv *Server, fileId, token string, offset int, chunk []byte) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads/"+fileId, bytes.NewReader(chunk))
	req.Header.Set(HeaderOwnerToken, token)
	req.Header.Set(HeaderUploadOffset, strconv.Itoa(offset))
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	return w
}

func finish(t *testing.T, srv *Server, fileId, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads/"+fileId+"/finish", nil)
	req.Header.Set(HeaderOwnerToken, token)
	w := httptest.NewRecorder()
	srv.Handler.ServeHTTP(w, req)

	return w
}

// TestChunkedUploadRoundTrip sends a file in pieces and downloads it whole.
func TestChunkedUploadRoundTrip(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, token := begin(t, srv, map[string]string{"count": "2", "filename": "in-pieces.bin"})

	content := bytes.Repeat([]byte("gdprshare"), 5000)
	const chunk = 4096
	for offset := 0; offset < len(content); offset += chunk {
		end := min(offset+chunk, len(content))

		w := appendChunk(t, srv, fileId, token, offset, content[offset:end])
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	}

	// nothing is downloadable before the upload is finished
	require.Equal(t, http.StatusNotFound, downloadOnce(t, srv, fileId).Code)

	w := finish(t, srv, fileId, token)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	assert.Equal(t, "/d/"+fileId, w.Header().Get("Location"))

	got := downloadOnce(t, srv, fileId)
	require.Equal(t, http.StatusOK, got.Code)
	assert.Equal(t, content, got.Body.Bytes())
}

// TestChunkedUploadRejectsAWrongOffset keeps a chunk sent twice, or one that
// skips ahead, from quietly corrupting the file.
func TestChunkedUploadRejectsAWrongOffset(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, token := begin(t, srv, nil)
	require.Equal(t, http.StatusOK, appendChunk(t, srv, fileId, token, 0, []byte("first")).Code)

	// the same chunk again
	again := appendChunk(t, srv, fileId, token, 0, []byte("first"))
	assert.Equal(t, http.StatusConflict, again.Code)
	assert.Equal(t, string(ErrCodeUploadOffset), decodeError(t, again).Code)
	// and the sender is told where to carry on from
	assert.Equal(t, "5", again.Header().Get(HeaderUploadOffset))

	// one that skips over bytes that were never sent
	ahead := appendChunk(t, srv, fileId, token, 500, []byte("later"))
	assert.Equal(t, http.StatusConflict, ahead.Code)

	require.Equal(t, http.StatusCreated, finish(t, srv, fileId, token).Code)

	got := downloadOnce(t, srv, fileId)
	require.Equal(t, http.StatusOK, got.Code)
	assert.Equal(t, "first", got.Body.String())
}

// TestChunkedUploadNeedsTheOwnerToken keeps a passer-by from writing into
// somebody else's upload.
func TestChunkedUploadNeedsTheOwnerToken(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, token := begin(t, srv, nil)

	assert.Equal(t, http.StatusUnauthorized, appendChunk(t, srv, fileId, "not-the-token", 0, []byte("x")).Code)
	assert.Equal(t, http.StatusUnauthorized, finish(t, srv, fileId, "not-the-token").Code)

	// and the upload is untouched by the attempt
	require.Equal(t, http.StatusOK, appendChunk(t, srv, fileId, token, 0, []byte("mine")).Code)
	require.Equal(t, http.StatusCreated, finish(t, srv, fileId, token).Code)
	assert.Equal(t, "mine", downloadOnce(t, srv, fileId).Body.String())
}

// TestChunkedUploadStopsAtTheSizeLimit holds the total to what one request is
// allowed, which the per-request limit alone cannot do.
func TestChunkedUploadStopsAtTheSizeLimit(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	srv.config.MaxUploadSize = 1
	limit := int(srv.config.MaxUploadSize * 1024 * 1024)

	fileId, token := begin(t, srv, nil)

	chunk := bytes.Repeat([]byte("a"), 256*1024)
	var offset int
	var refused *httptest.ResponseRecorder
	for i := 0; i < 8; i++ {
		w := appendChunk(t, srv, fileId, token, offset, chunk)
		if w.Code != http.StatusOK {
			refused = w
			break
		}
		offset += len(chunk)
	}

	require.NotNil(t, refused, "the upload was never refused")
	assert.Equal(t, http.StatusRequestEntityTooLarge, refused.Code)
	assert.Equal(t, string(ErrCodeUploadTooLarge), decodeError(t, refused).Code)

	// nothing past the limit was written
	var storedFile database.StoredFile
	require.NoError(t, srv.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error)
	info, err := os.Stat(filepath.Join(srv.config.StorePath, storedFile.Name))
	require.NoError(t, err)
	assert.LessOrEqual(t, int(info.Size()), limit)
}

// TestChunkedUploadTakesNoMoreAfterFinishing stops bytes from being added to a
// file a recipient may already be downloading.
func TestChunkedUploadTakesNoMoreAfterFinishing(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, token := begin(t, srv, nil)
	require.Equal(t, http.StatusOK, appendChunk(t, srv, fileId, token, 0, []byte("all of it")).Code)
	require.Equal(t, http.StatusCreated, finish(t, srv, fileId, token).Code)

	late := appendChunk(t, srv, fileId, token, 9, []byte(" and more"))
	assert.Equal(t, http.StatusConflict, late.Code)
	assert.Equal(t, string(ErrCodeUploadFinished), decodeError(t, late).Code)

	assert.Equal(t, "all of it", downloadOnce(t, srv, fileId).Body.String())
}

// TestPendingUploadCannotBeProlonged covers the other door into a share that
// has not arrived.
func TestPendingUploadCannotBeProlonged(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, token := begin(t, srv, map[string]string{"expiry": "2", "count": "1"})

	w := prolong(t, srv, fileId, token, "1", "1")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// TestUploadBeginCoversTheForm keeps UploadBegin in step with the fields an
// upload in one request accepts: a field only one of them knows would be
// silently dropped for uploads in pieces.
func TestUploadBeginCoversTheForm(t *testing.T) {
	formFields := func(t reflect.Type) []string {
		var names []string
		for i := 0; i < t.NumField(); i++ {
			tag := t.Field(i).Tag.Get("form")
			// the file itself has no place in the opening request, and "-" is
			// how a field says it is not part of the form
			if tag == "" || tag == "-" || tag == "file" {
				continue
			}
			names = append(names, tag)
		}
		return names
	}

	want := formFields(reflect.TypeOf(database.StoredFile{}))
	got := formFields(reflect.TypeOf(UploadBegin{}))

	assert.ElementsMatch(t, want, got,
		fmt.Sprintf("UploadBegin has %v, StoredFile takes %v", got, want))
}

// TestChunkedUploadOutlivesTheOrdinaryRateLimit covers what a large file
// actually does: hundreds of requests in a row. Under the ordinary limit it
// would throttle itself to a halt.
func TestChunkedUploadOutlivesTheOrdinaryRateLimit(t *testing.T) {
	srv, cleanup := setupTestServerWith(t, func(conf *config.Config) {
		conf.RateLimit.Enabled = true
		conf.RateLimit.RPS = 2
		conf.RateLimit.Burst = 2
	})
	defer cleanup()

	fileId, token := begin(t, srv, nil)

	// well past the ordinary burst of two
	chunk := []byte("a piece of the file")
	for i := 0; i < 20; i++ {
		w := appendChunk(t, srv, fileId, token, i*len(chunk), chunk)
		require.Equal(t, http.StatusOK, w.Code, "chunk %d: %s", i, w.Body.String())
	}

	// every piece landed, in order
	var storedFile database.StoredFile
	require.NoError(t, srv.db.Where(&database.StoredFile{FileId: fileId}).Find(&storedFile).Error)
	stored, err := os.ReadFile(filepath.Join(srv.config.StorePath, storedFile.Name))
	require.NoError(t, err)
	assert.Equal(t, bytes.Repeat(chunk, 20), stored)

	// the pieces have a limit of their own: they do not lift the one on
	// everything else
	var limited bool
	for i := 0; i < 10; i++ {
		if downloadOnce(t, srv, fileId).Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	assert.True(t, limited, "an ordinary endpoint was never rate limited")
}

// TestChunkedUploadRefusesAnEmptyChunk keeps a sender from looping over chunks
// that move the upload nowhere.
func TestChunkedUploadRefusesAnEmptyChunk(t *testing.T) {
	srv, cleanup := setupTestServer(t)
	defer cleanup()

	fileId, token := begin(t, srv, nil)

	w := appendChunk(t, srv, fileId, token, 0, nil)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, string(ErrCodeInvalidUpload), decodeError(t, w).Code)
}
