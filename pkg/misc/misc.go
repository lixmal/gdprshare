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

// DeleteStoredFile removes a share: the ciphertext, the row that describes it,
// and everything that was recorded about who sent it and who came for it.
//
// All of it goes for good rather than being marked deleted. A share that has
// run out is the one thing this server promises to be rid of, and what it holds
// is the sender's address and the address, user agent and location of every
// download attempt: none of that is worth keeping once the share it belonged to
// is gone.
func DeleteStoredFile(f *database.StoredFile, db *database.Database, config *config.Config) []error {
	var errors []error

	// The ciphertext of a share whose downloads ran out is deleted as it is
	// handed over, so it being gone already is the ordinary case rather than a
	// failure.
	path := filepath.Join(config.StorePath, f.Name)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		errors = append(errors, fmt.Errorf("delete file with id %s from storage: %w", f.FileId, err))
	}

	if errs := deleteClients(f.ID, db); len(errs) > 0 {
		errors = append(errors, errs...)
	}

	if err := db.Unscoped().Delete(f).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete file with id %s from database: %w", f.FileId, err))
	}

	return errors
}

// deleteClients removes what was recorded about the sender of a share and about
// everyone who asked for it.
func deleteClients(storedFileId uint, db *database.Database) []error {
	var errors []error

	if err := db.Unscoped().
		Where("stored_file_id = ?", storedFileId).
		Delete(&database.Client{}).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete the sender of file %d: %w", storedFileId, err))
	}

	if err := db.Unscoped().
		Where("stored_file_id = ?", storedFileId).
		Delete(&database.DstClient{}).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete the download records of file %d: %w", storedFileId, err))
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

	// A session and a login that is under way both carry their own end, and
	// neither is worth keeping past it.
	if err := db.Unscoped().
		Where("expires_at < ?", now).
		Delete(&database.Session{}).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete expired sessions: %w", err))
	}

	if err := db.Unscoped().
		Where("expires_at < ?", now).
		Delete(&database.Login{}).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete abandoned logins: %w", err))
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

	return append(errors, sweepLeftovers(db)...)
}

// sweepLeftovers clears what a database written before shares were deleted for
// good still holds: rows that were marked deleted rather than removed, and the
// sender and download records of shares that are no longer there. A sweep after
// that finds nothing, since the two go together now.
func sweepLeftovers(db *database.Database) []error {
	var errors []error

	if err := db.Unscoped().
		Where("deleted_at IS NOT NULL").
		Delete(&database.StoredFile{}).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete files that were only marked deleted: %w", err))
	}

	// A share is the only thing that puts a row in these tables, so one that
	// names a share which is gone belongs to nothing. Rows that name no share
	// at all are left alone: they say nothing about which share they were for,
	// and deleting on that basis would be guessing.
	const orphaned = "stored_file_id != 0 AND stored_file_id NOT IN (SELECT id FROM stored_files)"

	if err := db.Unscoped().Where(orphaned).Delete(&database.Client{}).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete senders of files that are gone: %w", err))
	}

	if err := db.Unscoped().Where(orphaned).Delete(&database.DstClient{}).Error; err != nil {
		errors = append(errors, fmt.Errorf("delete download records of files that are gone: %w", err))
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
