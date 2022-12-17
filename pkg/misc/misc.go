package misc

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

func GenToken(length int) (string, error) {
	buf := make([]byte, length)

	_, err := rand.Read(buf)
	if err != nil {
		return "", err
	}

	token := base64.RawURLEncoding.EncodeToString(buf)

	return token, nil
}

func DeleteStoredFile(f *database.StoredFile, db *database.Database, config *config.Config) []error {
	var errors []error

	path := filepath.Join(config.StorePath, f.Name)
	if err := os.Remove(path); err != nil {
		errors = append(errors, fmt.Errorf("delete file with id %s from storage: %w", f.FileId, err))
	}
	if err := db.Delete(&f).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete file with id %s from database: %w", f.FileId, err))
	}

	return errors
}

func Cleanup(db *database.Database, config *config.Config) []error {
	var expired []database.StoredFile
	var errors []error

	if errs := db.Where("datetime(created_at, expiry || ' days') < datetime('now')").Find(&expired).GetErrors(); errs != nil {
		for _, err := range errs {
			if !db.IsRecordNotFoundError(err) {
				errors = append(errors, err)
			}
		}
	}

	for _, v := range expired {
		if errs := DeleteStoredFile(&v, db, config); len(errs) > 0 {
			errors = append(errors, errs...)
		}
	}

	return errors
}
