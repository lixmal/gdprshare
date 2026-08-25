package database

import (
	"mime/multipart"
	"time"

	"github.com/jinzhu/gorm"

	"github.com/lixmal/gdprshare/pkg/geoip"
)

type Client struct {
	gorm.Model
	StoredFileId   uint
	Addr           string
	UserAgent      string
	TLSVersion     string
	TLSCipherSuite string
	// Set when the download was refused. The share keeps the attempt so its
	// owner can see that someone tried and why it did not go through.
	Denied bool
	// The error code the attempt was answered with, empty for a download that
	// went through.
	Reason   string
	Location *geoip.Location `gorm:"-"`
}

type DstClient Client

type StoredFile struct {
	gorm.Model
	Type             string                `form:"type"                                     binding:"omitempty,printascii,min=1,max=255"`
	FileId           string                `form:"-"              gorm:"not null"`
	OwnerToken       string                `form:"-"`
	File             *multipart.FileHeader `form:"file"           gorm:"-"                  binding:"required"`
	Filename         string                `form:"filename"       gorm:"type:varchar(1024)" binding:"omitempty,max=1024"`
	Name             string                `form:"-"              gorm:"not null"`
	Email            string                `form:"email"                                    binding:"omitempty,email,min=4,max=255"`
	Expiry           uint                  `form:"expiry"         gorm:"default:14"         binding:"omitempty,min=1,max=14"`
	Count            uint                  `form:"count"          gorm:"default:1"          binding:"omitempty,min=1,max=15"`
	OnlyEEA          bool                  `form:"only-eea"`
	IncludeOther     bool                  `form:"include-other"`
	AllowedCountries string                `form:"allowed-countries" gorm:"type:text"    binding:"omitempty,max=2000"`
	Delay            uint                  `form:"delay"                                    binding:"omitempty,min=0,max=1440"`
	Ephemeral        uint                  `form:"ephemeral"          gorm:"default:0"      binding:"omitempty,min=0,max=300"`
	// Set while the file is still arriving in pieces. Such a share is not
	// downloadable and cannot be extended; it becomes an ordinary one when the
	// upload is finished, and is swept away if it never is.
	Pending    bool         `form:"-"`
	SrcClient  *Client      `form:"-"`
	DstClients []*DstClient `form:"-"`
}

// Session is a signed in visitor. It lives in the database rather than in a
// cookie the server signs, so that no secret exists which could mint one, and
// so that signing out or losing a group ends a session at once instead of
// whenever it would have expired. The cookie carries the id and nothing else.
type Session struct {
	gorm.Model
	SessionId string `gorm:"not null;unique_index"`
	Subject   string `gorm:"not null"`
	Email     string
	// as the provider gave them, comma separated
	Groups    string
	ExpiresAt time.Time `gorm:"not null"`
}

// Login is a sign in that is under way: what has to come back from the provider
// unchanged for the answer to be this server's own question. It is deleted the
// moment it is answered, and swept if it never is.
type Login struct {
	gorm.Model
	LoginId   string `gorm:"not null;unique_index"`
	State     string `gorm:"not null"`
	Nonce     string `gorm:"not null"`
	Verifier  string `gorm:"not null"`
	Return    string
	ExpiresAt time.Time `gorm:"not null"`
}

type Stats struct {
	URL     string `form:"url" gorm:"not null" binding:"required,url,max=255"`
	*Client `form:"-"`
}
