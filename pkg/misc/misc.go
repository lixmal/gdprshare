package misc

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

// GenToken generates a cryptographically secure random token of the specified length.
func GenToken(length int) (string, error) {
	buf := make([]byte, length)

	_, err := rand.Read(buf)
	if err != nil {
		return "", err
	}

	token := base64.RawURLEncoding.EncodeToString(buf)

	return token, nil
}

// DeleteStoredFile removes a stored file from both the filesystem and database.
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

// Cleanup removes expired files from the database and filesystem.
func Cleanup(db *database.Database, config *config.Config) []error {
	now := time.Now()
	var errors []error

	var files []database.StoredFile
	if err := db.Find(&files).Error; err != nil && !db.IsRecordNotFoundError(err) {
		return append(errors, fmt.Errorf("fetch files from database: %w", err))
	}

	for _, f := range files {
		expiryTime := f.CreatedAt.AddDate(0, 0, int(f.Expiry))

		if now.After(expiryTime) {
			if errs := DeleteStoredFile(&f, db, config); len(errs) > 0 {
				errors = append(errors, errs...)
			}
		}
	}

	return errors
}
