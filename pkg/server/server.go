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

	// MaxExpiryDays and MaxDownloadCount mirror the upload binding limits on
	// StoredFile.Expiry and StoredFile.Count. Prolonging a file stays within
	// them, so an owner can't extend a file beyond what an upload allows.
	MaxExpiryDays    = 14
	MaxDownloadCount = 15

	// A blocked link can be hit as often as someone likes, so a share keeps
	// only this many refusals. Downloads that went through are bounded by the
	// download count and need no cap.
	MaxDeniedRecords = 50

	// Error reports from the download page need no token, so the table they go
	// into is bounded as well. Reports past that are dropped, and the ones kept
	// go with the retention in the cleanup sweep.
	MaxStatsRecords = 1000

	// How much more often than an ordinary request a piece of a file may
	// arrive. A record is 4 MiB, so even the ordinary limit times this is far
	// more throughput than a link is worth.
	ChunkRateFactor = 20
)

type StoredFileInfo struct {
	ExpiryDate time.Time `json:"expiryDate"`
	Count      uint      `json:"count"`
	// MaxProlongDays and MaxProlongCount tell the client how much room is left
	// for prolonging, so it can offer only values the server accepts.
	MaxProlongDays  uint   `json:"maxProlongDays"`
	MaxProlongCount uint   `json:"maxProlongCount"`
	Error           string `json:"error"`
}

type FileId struct {
	FileId string `json:"fileId" uri:"fileId" binding:"required,printascii,min=3,max=64"`
}

type OwnerToken struct {
	OwnerToken string `form:"ownerToken" binding:"required,printascii,min=3,max=64"`
}

// UploadBegin opens a share whose file arrives in pieces. It carries what
// StoredFile takes as a form minus the file itself, since there are no bytes
// yet; TestUploadBeginCoversTheForm keeps the two in step.
type UploadBegin struct {
	Type             string `form:"type"              binding:"omitempty,printascii,min=1,max=255"`
	Filename         string `form:"filename"          binding:"omitempty,max=1024"`
	Email            string `form:"email"             binding:"omitempty,email,min=4,max=255"`
	Expiry           uint   `form:"expiry"            binding:"omitempty,min=1,max=14"`
	Count            uint   `form:"count"             binding:"omitempty,min=1,max=15"`
	OnlyEEA          bool   `form:"only-eea"`
	IncludeOther     bool   `form:"include-other"`
	AllowedCountries string `form:"allowed-countries" binding:"omitempty,max=2000"`
	Delay            uint   `form:"delay"             binding:"omitempty,min=0,max=1440"`
	Ephemeral        uint   `form:"ephemeral"         binding:"omitempty,min=0,max=300"`
}

func (u UploadBegin) storedFile() *database.StoredFile {
	return &database.StoredFile{
		Type:             u.Type,
		Filename:         u.Filename,
		Email:            u.Email,
		Expiry:           u.Expiry,
		Count:            u.Count,
		OnlyEEA:          u.OnlyEEA,
		IncludeOther:     u.IncludeOther,
		AllowedCountries: u.AllowedCountries,
		Delay:            u.Delay,
		Ephemeral:        u.Ephemeral,
	}
}

type ProlongRequest struct {
	OwnerToken
	Days  uint `form:"days"  binding:"omitempty,min=0,max=14"`
	Count uint `form:"count" binding:"omitempty,min=0,max=15"`
}

// One recipient's download, as the owner of a share gets to see it. It is the
// same material the notification mail carries, so this adds a way to read it
// rather than a new kind of record.
type DownloadRecord struct {
	Time      time.Time `json:"time"`
	Denied    bool      `json:"denied"`
	Reason    string    `json:"reason"`
	Address   string    `json:"address"`
	UserAgent string    `json:"userAgent"`
	// The user agent read as a short name, empty when it says nothing that can
	// be read. The raw string stays next to it: for a refused crawler it is the
	// evidence, and nothing forces a user agent to be true.
	Client     string `json:"client"`
	TLSVersion string `json:"tlsVersion"`
	TLSCipher  string `json:"tlsCipher"`
	Location   string `json:"location"`
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

	// HEAD as well as GET: a link handed to a chat program or a monitor is
	// often probed with HEAD first, and a page that answers 404 to that reads
	// as a dead link
	for _, page := range []string{"/", "/uploaded", "/d/:fileId"} {
		router.GET(page, srv.index)
		router.HEAD(page, srv.index)
	}

	v1 := router.Group("/api/v1")

	// A file arriving in pieces is many requests by design: hundreds of them for
	// a large one, which the ordinary limit would throttle to a crawl. The
	// pieces get a limit of their own, high enough that a real upload never
	// meets it, and what actually bounds them is the size of the whole file and
	// the owner token, both checked on every chunk.
	chunks := router.Group("/api/v1")

	if srv.config.RateLimit.Enabled {
		limiter := newRateLimiter(srv.config.RateLimit.RPS, srv.config.RateLimit.Burst)
		v1.Use(limiter.middleware())

		perChunk := newRateLimiter(
			srv.config.RateLimit.RPS*ChunkRateFactor,
			srv.config.RateLimit.Burst*ChunkRateFactor,
		)
		chunks.Use(perChunk.middleware())
	}

	v1.POST("/stats", srv.setStats)
	v1.GET("/config", srv.getConfig)
	v1.GET("/countries", srv.getCountries)
	v1.POST("/files", srv.uploadFile)
	v1.POST("/uploads", srv.beginUpload)
	chunks.POST("/uploads/:fileId", srv.appendUpload)
	v1.POST("/uploads/:fileId/finish", srv.finishUpload)
	v1.GET("/files/:fileId", srv.downloadFile)
	v1.HEAD("/files/:fileId", srv.headFile)
	v1.POST("/files/:fileId", srv.confirmReceipt)
	v1.DELETE("/files/:fileId", srv.deleteFile)
	v1.POST("/files/:fileId/prolong", srv.prolongFile)
	v1.POST("/files/:fileId/downloads", srv.downloadRecords)
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
