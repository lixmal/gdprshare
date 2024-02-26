package database

import (
	"mime/multipart"

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
	Location       *geoip.Location `gorm:"-"`
}

type DstClient Client

type StoredFile struct {
	gorm.Model
	Type         string                `form:"type"                                     binding:"omitempty,printascii,min=1,max=255"`
	FileId       string                `form:"-"              gorm:"not null"`
	OwnerToken   string                `form:"-"`
	File         *multipart.FileHeader `form:"file"           gorm:"-"                  binding:"required"`
	Filename     string                `form:"filename"       gorm:"type:varchar(1024)" binding:"omitempty,max=1024"`
	Name         string                `form:"-"              gorm:"not null"`
	Email        string                `form:"email"                                    binding:"omitempty,email,min=4,max=255"`
	Expiry       uint                  `form:"expiry"         gorm:"default:14"         binding:"omitempty,min=1,max=14"`
	Count        uint                  `form:"count"          gorm:"default:1"          binding:"omitempty,min=1,max=15"`
	OnlyEEA      bool                  `form:"only-eea"`
	IncludeOther bool                  `form:"include-other"`
	Delay        uint                  `form:"delay"                                    binding:"omitempty,min=0,max=1440"`
	SrcClient    *Client               `form:"-"`
	DstClients   []*DstClient          `form:"-"`
}

type Stats struct {
	URL     string `form:"url" gorm:"not null" binding:"required,url,max=255"`
	*Client `form:"-"`
}
