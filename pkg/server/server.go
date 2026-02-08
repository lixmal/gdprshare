package server

import (
	"net/http"
	"time"

	limits "github.com/gin-contrib/size"
	"github.com/gin-gonic/gin"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

const (
	MultipartMem  = 8 << 20 // 8M
	OwnerTokenLen = 20
	IndexFile     = "public/index.html"
)

type StoredFileInfo struct {
	ExpiryDate time.Time `json:"expiryDate"`
	Count      uint      `json:"count"`
	Error      string    `json:"error"`
}

type FileId struct {
	FileId string `json:"fileId" uri:"fileId" binding:"required,printascii,min=3,max=64"`
}

type OwnerToken struct {
	OwnerToken string `form:"ownerToken" binding:"required,printascii,min=3,max=64"`
}

type OwnedFile struct {
	FileId
	OwnerToken
}

type Server struct {
	*http.Server
	db     *database.Database
	config *config.Config
}

func setupRoutes(router *gin.Engine, srv *Server) {
	// TODO: add json response
	router.Use(limits.RequestSizeLimiter(srv.config.MaxUploadSize * 1024 * 1024))
	router.MaxMultipartMemory = MultipartMem

	router.Static("/assets", "public")

	router.GET("/", srv.index)
	router.GET("/uploaded", srv.index)
	router.GET("/d/:fileId", srv.index)

	v1 := router.Group("/api/v1")

	if srv.config.RateLimit.Enabled {
		limiter := newRateLimiter(srv.config.RateLimit.RPS, srv.config.RateLimit.Burst)
		v1.Use(limiter.middleware())
	}

	v1.POST("/stats", srv.setStats)
	v1.GET("/config", srv.getConfig)
	v1.GET("/countries", srv.getCountries)
	v1.POST("/files", srv.uploadFile)
	v1.GET("/files/:fileId", srv.downloadFile)
	v1.POST("/files/:fileId", srv.confirmReceipt)
	v1.DELETE("/files/:fileId", srv.deleteFile)
	v1.POST("/files/validate", srv.validateFiles)
}

// New creates a new Server instance with the given database and configuration.
func New(db *database.Database, conf *config.Config) *Server {
	router := gin.Default()

	srv := &Server{
		&http.Server{
			Addr:    conf.ListenAddr,
			Handler: router,
		},
		db,
		conf,
	}

	setupRoutes(router, srv)

	return srv
}

// Start starts the HTTP or HTTPS server based on the TLS configuration.
func (s *Server) Start() error {
	if s.config.TLS.Use {
		return s.ListenAndServeTLS(s.config.TLS.Cert, s.config.TLS.Key)
	}
	return s.ListenAndServe()
}
