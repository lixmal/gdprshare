package misc

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

// PendingUploadTimeout is how long a file that arrives in pieces may stay
// unfinished. A sender who walks away mid-upload otherwise leaves the bytes and
// the row behind for as long as the share would have lived.
const PendingUploadTimeout = time.Hour

// StatsRetention is how long an error report from the download page is kept.
// The rows carry the address and user agent of whoever hit a broken link, so
// they go the way a share does rather than sitting there for good.
const StatsRetention = 14 * 24 * time.Hour

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

// Cleanup removes expired files from the database and filesystem, and drops
// error reports that are past their retention.
func Cleanup(db *database.Database, config *config.Config) []error {
	now := time.Now()
	var errors []error

	if err := db.Unscoped().
		Where("created_at < ?", now.Add(-StatsRetention)).
		Delete(&database.Stats{}).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete expired stats: %w", err))
	}

	var files []database.StoredFile
	if err := db.Find(&files).Error; err != nil && !db.IsRecordNotFoundError(err) {
		return append(errors, fmt.Errorf("fetch files from database: %w", err))
	}

	for _, f := range files {
		expiryTime := f.CreatedAt.AddDate(0, 0, int(f.Expiry))
		if f.Pending {
			// an upload that was never finished goes much sooner than the share
			// it would have become
			expiryTime = f.CreatedAt.Add(PendingUploadTimeout)
		}

		if now.After(expiryTime) {
			if errs := DeleteStoredFile(&f, db, config); len(errs) > 0 {
				errors = append(errors, errs...)
			}
		}
	}

	return errors
}

// RunCleanup sweeps expired files until the context is cancelled, starting with
// one sweep right away: a server that is restarted often would otherwise never
// reach the end of an interval. Errors are logged and the loop carries on, since
// one unreadable file must not stop the rest from being deleted.
func RunCleanup(ctx context.Context, db *database.Database, config *config.Config, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		for _, err := range Cleanup(db, config) {
			log.Printf("File cleanup: %s\n", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
