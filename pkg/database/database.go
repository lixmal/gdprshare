package database

import (
	"fmt"

	"github.com/jinzhu/gorm"
	_ "github.com/jinzhu/gorm/dialects/sqlite"
	// _ "github.com/jinzhu/gorm/dialects/postgres"
	// _ "github.com/jinzhu/gorm/dialects/mysql"
	// _ "github.com/jinzhu/gorm/dialects/mssql"

	"github.com/lixmal/gdprshare/pkg/config"
)

type Database struct {
	*gorm.DB
}

func New(config *config.Config) (*Database, error) {
	db, err := gorm.Open(config.Database.Driver, config.Database.Args)
	if err != nil {
		return nil, fmt.Errorf("connect to database: %s", err)
	}

	if err = db.AutoMigrate(&Client{}).Error; err != nil {
		return nil, fmt.Errorf("migrate schema client: %s", err)
	}

	if err = db.AutoMigrate(&DstClient{}).Error; err != nil {
		return nil, fmt.Errorf("migrate schema dst client: %s", err)
	}

	if err = db.AutoMigrate(&StoredFile{}).Error; err != nil {
		return nil, fmt.Errorf("migrate schema stored file: %s", err)
	}

	if err = db.AutoMigrate(&Stats{}).Error; err != nil {
		return nil, fmt.Errorf("migrate schema stats: %s", err)
	}

	return &Database{db}, nil
}

func (*Database) IsRecordNotFoundError(err error) bool {
	return gorm.IsRecordNotFoundError(err)
}