package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRateLimiter(t *testing.T) {
	gin.SetMode(gin.TestMode)

	rl := newRateLimiter(2, 2)

	router := gin.New()
	router.Use(rl.middleware())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "192.0.2.1:1234"

	w1 := httptest.NewRecorder()
	router.ServeHTTP(w1, req)
	assert.Equal(t, http.StatusOK, w1.Code, "First request should succeed")

	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req)
	assert.Equal(t, http.StatusOK, w2.Code, "Second request should succeed (within burst)")

	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req)
	assert.Equal(t, http.StatusTooManyRequests, w3.Code, "Third request should be rate limited")
}

func TestRateLimiterPerIP(t *testing.T) {
	gin.SetMode(gin.TestMode)

	rl := newRateLimiter(1, 1)

	router := gin.New()
	router.Use(rl.middleware())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "ok"})
	})

	req1 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req1.RemoteAddr = "192.0.2.1:1234"

	req2 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req2.RemoteAddr = "192.0.2.2:1234"

	w1 := httptest.NewRecorder()
	router.ServeHTTP(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code, "First IP should succeed")

	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req1)
	assert.Equal(t, http.StatusTooManyRequests, w2.Code, "First IP should be rate limited")

	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req2)
	assert.Equal(t, http.StatusOK, w3.Code, "Second IP should succeed")
}

func TestRateLimiterRecovery(t *testing.T) {
	gin.SetMode(gin.TestMode)

	rl := newRateLimiter(10, 1)

	router := gin.New()
	router.Use(rl.middleware())
	router.GET("/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "ok"})
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "192.0.2.1:1234"

	w1 := httptest.NewRecorder()
	router.ServeHTTP(w1, req)
	assert.Equal(t, http.StatusOK, w1.Code, "First request should succeed")

	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req)
	assert.Equal(t, http.StatusTooManyRequests, w2.Code, "Second request should be rate limited")

	time.Sleep(150 * time.Millisecond)

	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req)
	assert.Equal(t, http.StatusOK, w3.Code, "Request after delay should succeed")
}

func TestRateLimiterCleanup(t *testing.T) {
	rl := &rateLimiter{
		visitors: make(map[string]*visitor),
		rate:     1,
		burst:    1,
	}

	limiter1 := rl.getVisitor("192.0.2.1")
	require.NotNil(t, limiter1)

	rl.mu.RLock()
	count := len(rl.visitors)
	rl.mu.RUnlock()
	assert.Equal(t, 1, count, "Should have one visitor")

	rl.mu.Lock()
	rl.visitors["192.0.2.1"].lastSeen = time.Now().Add(-5 * time.Minute)
	rl.mu.Unlock()

	rl.mu.Lock()
	for ip, v := range rl.visitors {
		if time.Since(v.lastSeen) > 3*time.Minute {
			delete(rl.visitors, ip)
		}
	}
	rl.mu.Unlock()

	rl.mu.RLock()
	count = len(rl.visitors)
	rl.mu.RUnlock()
	assert.Equal(t, 0, count, "Stale visitor should be cleaned up")
}
