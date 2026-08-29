package server

import (
	"fmt"
	"log"
	"net/http"
	"time"

	limits "github.com/gin-contrib/size"
	"github.com/gin-gonic/gin"

	"github.com/lixmal/gdprshare/pkg/auth"
	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
	"github.com/lixmal/gdprshare/pkg/trustedproxy"
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
	// nil when the server asks nobody to sign in
	guard *auth.Guard
	// who may speak for someone else: whose X-Forwarded-For decides the client
	// address, and whose headers may state the encryption of a connection this
	// server did not terminate itself
	proxies *trustedproxy.List
}

// letThrough is what stands in for the guard where nobody has to sign in, so
// every route reads the same whether a provider is configured or not.
func letThrough(c *gin.Context) {
	c.Next()
}

// Who has to sign in for which routes. A share's recipient is not a user of
// this server, only the person a link was sent to, so the download side is left
// open unless the operator says otherwise.
type guards struct {
	senderPage    gin.HandlerFunc
	sender        gin.HandlerFunc
	recipientPage gin.HandlerFunc
	recipient     gin.HandlerFunc
}

func (s *Server) guards() guards {
	open := guards{letThrough, letThrough, letThrough, letThrough}
	if s.guard == nil {
		return open
	}

	open.senderPage = s.guard.Require(true)
	open.sender = s.guard.Require(false)

	if s.config.OIDC.Protect == "all" {
		open.recipientPage = open.senderPage
		open.recipient = open.sender
	}

	return open
}

func setupRoutes(router *gin.Engine, srv *Server) {
	if *srv.config.SecurityHeaders.Enabled {
		router.Use(srv.securityHeaders())
	}

	// TODO: add json response
	router.Use(limits.RequestSizeLimiter(srv.config.MaxUploadSize * 1024 * 1024))
	router.MaxMultipartMemory = MultipartMem

	// The bundle, the styles and the fonts stay open: the download page is
	// built from them, and they hold nothing that is not public anyway.
	router.Static("/assets", "public")

	who := srv.guards()

	if srv.guard != nil {
		srv.guard.Register(router)
	}

	// HEAD as well as GET: a link handed to a chat program or a monitor is
	// often probed with HEAD first, and a page that answers 404 to that reads
	// as a dead link
	pages := map[string]gin.HandlerFunc{
		"/":          who.senderPage,
		"/uploaded":  who.senderPage,
		"/d/:fileId": who.recipientPage,
	}
	for page, guard := range pages {
		router.GET(page, guard, srv.index)
		router.HEAD(page, guard, srv.index)
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

	// what the recipient of a link needs
	v1.POST("/stats", who.recipient, srv.setStats)
	v1.GET("/config", who.recipient, srv.getConfig)
	v1.GET("/files/:fileId", who.recipient, srv.downloadFile)
	v1.HEAD("/files/:fileId", who.recipient, srv.headFile)
	v1.POST("/files/:fileId", who.recipient, srv.confirmReceipt)

	// what the sender needs
	v1.GET("/countries", who.sender, srv.getCountries)
	v1.POST("/files", who.sender, srv.uploadFile)
	v1.POST("/uploads", who.sender, srv.beginUpload)
	chunks.POST("/uploads/:fileId", who.sender, srv.appendUpload)
	v1.POST("/uploads/:fileId/finish", who.sender, srv.finishUpload)
	v1.DELETE("/files/:fileId", who.sender, srv.deleteFile)
	v1.POST("/files/:fileId/prolong", who.sender, srv.prolongFile)
	v1.POST("/files/:fileId/downloads", who.sender, srv.downloadRecords)
	v1.POST("/files/validate", who.sender, srv.validateFiles)
}

// warnAboutTrust says out loud what the defaults leave open. Both of these are
// how this server has always behaved, so neither is a reason to refuse to
// start, but an operator should not have to read the code to find out.
func warnAboutTrust(conf *config.Config, proxies *trustedproxy.List) {
	if proxies.Everyone() {
		log.Println(
			"SECURITY: trustedproxies is 'all', so X-Forwarded-For and the TLS headers are believed from any client." +
				" Anything that can reach this server directly then picks its own rate limit bucket, its own country" +
				" and its own TLS evidence. Set trustedproxies to the addresses of the proxy in front, or to 'none'" +
				" when there is none.",
		)
	}

	if conf.TLSValidation.Enabled && !conf.TLSValidation.Required {
		log.Println(
			"SECURITY: tlsvalidation is enabled but not required, so a request that says nothing about its" +
				" encryption is let through unchecked. Set tlsvalidation.required once the connection or the proxy" +
				" in front actually reports it.",
		)
	}
}

// trustsPeer reports whether the request arrived from a proxy this server was
// told to believe. Anything a client can set itself is only read when it did.
func (s *Server) trustsPeer(c *gin.Context) bool {
	return s.proxies.IsTrusted(c.Request.RemoteAddr)
}

// New creates a new Server instance with the given database and configuration.
func New(db *database.Database, conf *config.Config) (*Server, error) {
	router := gin.Default()

	// a config that was put together rather than loaded still has to arrive
	// here whole
	conf.ApplyDefaults()

	proxies, err := conf.TrustedProxyList()
	if err != nil {
		return nil, err
	}

	// gin trusts every proxy until it is told otherwise, so this is set on
	// every start rather than only when the operator named someone.
	if err := router.SetTrustedProxies(proxies.Prefixes()); err != nil {
		return nil, fmt.Errorf("set the trusted proxies: %w", err)
	}

	warnAboutTrust(conf, proxies)

	srv := &Server{
		Server: &http.Server{
			Addr:    conf.ListenAddr,
			Handler: router,
		},
		db:      db,
		config:  conf,
		proxies: proxies,
	}

	// A provider that cannot be set up is a reason not to start: carrying on
	// without it would serve the app to everyone.
	if conf.OIDC.Enabled {
		guard, err := auth.NewGuard(conf, db)
		if err != nil {
			return nil, fmt.Errorf("set up the identity provider: %w", err)
		}

		srv.guard = guard
	}

	setupRoutes(router, srv)

	return srv, nil
}

// Start starts the HTTP or HTTPS server based on the TLS configuration.
func (s *Server) Start() error {
	if s.config.TLS.Use {
		return s.ListenAndServeTLS(s.config.TLS.Cert, s.config.TLS.Key)
	}
	return s.ListenAndServe()
}
