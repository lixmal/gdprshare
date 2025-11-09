package database

import (
	"fmt"

	"github.com/jinzhu/gorm"
	_ "github.com/jinzhu/gorm/dialects/mysql"
	_ "github.com/jinzhu/gorm/dialects/postgres"
	_ "github.com/jinzhu/gorm/dialects/sqlite"

	"github.com/lixmal/gdprshare/pkg/config"
)

type Database struct {
	*gorm.DB
}

// New creates a new Database instance and performs schema migrations.
func New(config *config.Config) (*Database, error) {
	db, err := gorm.Open(config.Database.Driver, config.Database.Args)
	if err != nil {
		return nil, fmt.Errorf("connect to database: %w", err)
	}

	if err = db.AutoMigrate(&Client{}).Error; err != nil {
		return nil, fmt.Errorf("migrate schema client: %w", err)
	}

	if err = db.AutoMigrate(&DstClient{}).Error; err != nil {
		return nil, fmt.Errorf("migrate schema dst client: %w", err)
	}

	if err = db.AutoMigrate(&StoredFile{}).Error; err != nil {
		return nil, fmt.Errorf("migrate schema stored file: %w", err)
	}

	if err = db.AutoMigrate(&Stats{}).Error; err != nil {
		return nil, fmt.Errorf("migrate schema stats: %w", err)
	}

	return &Database{db}, nil
}

// IsRecordNotFoundError checks if the given error is a GORM "record not found" error.
func (*Database) IsRecordNotFoundError(err error) bool {
	return gorm.IsRecordNotFoundError(err)
}
