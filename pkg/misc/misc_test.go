package misc

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/config"
	"github.com/lixmal/gdprshare/pkg/database"
)

// storedFile writes a file to the store and records it, aged by the given
// number of days so it counts as expired.
func storedFile(t *testing.T, db *database.Database, conf *config.Config, name string, expiry uint, ageDays int) string {
	t.Helper()

	path := filepath.Join(conf.StorePath, name)
	require.NoError(t, os.WriteFile(path, []byte("payload"), 0600))

	file := database.StoredFile{
		FileId: name,
		Name:   name,
		Expiry: expiry,
		Count:  1,
	}
	require.NoError(t, db.Create(&file).Error)

	// gorm sets CreatedAt on create, so the age has to be written afterwards
	created := time.Now().AddDate(0, 0, -ageDays)
	require.NoError(t, db.Model(&file).UpdateColumn("created_at", created).Error)

	return path
}

func setup(t *testing.T) (*database.Database, *config.Config) {
	t.Helper()

	conf := config.Default()
	conf.Database.Driver = "sqlite3"
	conf.Database.Args = ":memory:"
	conf.StorePath = t.TempDir()

	db, err := database.New(conf)
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })

	return db, conf
}

// TestCleanupRemovesOnlyExpiredFiles keeps a live file and deletes the stale one
func TestCleanupRemovesOnlyExpiredFiles(t *testing.T) {
	db, conf := setup(t)

	stale := storedFile(t, db, conf, "stale", 1, 3)
	live := storedFile(t, db, conf, "live", 14, 1)

	assert.Empty(t, Cleanup(db, conf))

	_, err := os.Stat(stale)
	assert.True(t, os.IsNotExist(err), "the expired file is still on disk")
	assert.FileExists(t, live)

	var left []database.StoredFile
	require.NoError(t, db.Find(&left).Error)
	require.Len(t, left, 1)
	assert.Equal(t, "live", left[0].FileId)
}

// TestRunCleanupSweepsOnStart covers the loop the server runs: the first sweep
// happens immediately, and cancelling the context ends it.
func TestRunCleanupSweepsOnStart(t *testing.T) {
	db, conf := setup(t)

	stale := storedFile(t, db, conf, "stale", 1, 3)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		RunCleanup(ctx, db, conf, time.Hour)
		close(done)
	}()

	require.Eventually(t, func() bool {
		_, err := os.Stat(stale)
		return os.IsNotExist(err)
	}, 2*time.Second, 10*time.Millisecond, "the first sweep did not run")

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the loop kept running after its context was cancelled")
	}
}

// TestCleanupIntervalValidation rejects an interval the loop cannot use
func TestCleanupIntervalValidation(t *testing.T) {
	conf := config.Default()
	conf.Cleanup.Enabled = true

	conf.Cleanup.Interval = "30m"
	interval, err := conf.CleanupInterval()
	require.NoError(t, err)
	assert.Equal(t, 30*time.Minute, interval)

	conf.Cleanup.Interval = "nonsense"
	_, err = conf.CleanupInterval()
	assert.Error(t, err)
}

// TestCleanupDropsOldStats lets an error report from the download page go the
// way a share does. The rows carry an address and a user agent, so they are not
// kept for good.
func TestCleanupDropsOldStats(t *testing.T) {
	db, conf := setup(t)

	fresh := database.Stats{URL: "https://example.org/d/fresh"}
	require.NoError(t, db.Create(&fresh).Error)

	stale := database.Stats{URL: "https://example.org/d/stale"}
	require.NoError(t, db.Create(&stale).Error)
	require.NoError(t, db.Model(&stale).
		UpdateColumn("created_at", time.Now().Add(-StatsRetention-time.Hour)).Error)

	assert.Empty(t, Cleanup(db, conf))

	var left []database.Stats
	require.NoError(t, db.Find(&left).Error)
	require.Len(t, left, 1)
	assert.Equal(t, "https://example.org/d/fresh", left[0].URL)

	// gone for good, not soft deleted: the point is that the data is not kept
	var all int
	require.NoError(t, db.Unscoped().Model(&database.Stats{}).Count(&all).Error)
	assert.Equal(t, 1, all)
}

// TestCleanupDropsAbandonedUploads sweeps a file that arrived in pieces and was
// never finished, which would otherwise sit there for the share's whole life.
func TestCleanupDropsAbandonedUploads(t *testing.T) {
	db, conf := setup(t)

	// both would live for 14 days had they been finished
	fresh := storedFile(t, db, conf, "still-arriving", 14, 0)
	stale := storedFile(t, db, conf, "walked-away", 14, 0)

	require.NoError(t, db.Model(&database.StoredFile{}).
		Where("name in (?)", []string{"still-arriving", "walked-away"}).
		Update("pending", true).Error)
	require.NoError(t, db.Model(&database.StoredFile{}).
		Where("name = ?", "walked-away").
		UpdateColumn("created_at", time.Now().Add(-PendingUploadTimeout-time.Minute)).Error)

	assert.Empty(t, Cleanup(db, conf))

	assert.FileExists(t, fresh)
	assert.NoFileExists(t, stale)

	var left []database.StoredFile
	require.NoError(t, db.Find(&left).Error)
	require.Len(t, left, 1)
	assert.Equal(t, "still-arriving", left[0].Name)
}
