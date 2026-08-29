package misc

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/lixmal/gdprshare/pkg/database"
)

// shareWithRecords writes a share along with what would be recorded about the
// person who sent it and the people who came for it.
func shareWithRecords(t *testing.T, db *database.Database, name string) *database.StoredFile {
	t.Helper()

	file := database.StoredFile{
		FileId:    name,
		Name:      name,
		Email:     "sender@example.org",
		Count:     1,
		Expiry:    14,
		SrcClient: &database.Client{Addr: "203.0.113.9", UserAgent: "curl/8"},
	}
	require.NoError(t, db.Create(&file).Error)

	for _, addr := range []string{"198.51.100.4", "198.51.100.5"} {
		require.NoError(t, db.Create(&database.DstClient{
			StoredFileId: file.ID,
			Addr:         addr,
			UserAgent:    "Firefox",
		}).Error)
	}

	return &file
}

func countRows(t *testing.T, db *database.Database) (files, clients, dst int) {
	t.Helper()

	// unscoped, since a row that is only marked deleted is still a row holding
	// somebody's address
	require.NoError(t, db.Unscoped().Model(&database.StoredFile{}).Count(&files).Error)
	require.NoError(t, db.Unscoped().Model(&database.Client{}).Count(&clients).Error)
	require.NoError(t, db.Unscoped().Model(&database.DstClient{}).Count(&dst).Error)

	return files, clients, dst
}

// A deleted share leaves nothing: not the row, not the sender's address, and
// not the record of anyone who asked for it.
func TestDeleteStoredFileLeavesNothingBehind(t *testing.T) {
	db, conf := setup(t)

	file := shareWithRecords(t, db, "gone")
	require.NoError(t, db.Create(&database.DstClient{StoredFileId: file.ID + 1000, Addr: "10.0.0.1"}).Error)

	assert.Empty(t, DeleteStoredFile(file, db, conf))

	files, clients, dst := countRows(t, db)
	assert.Zero(t, files)
	assert.Zero(t, clients)
	assert.Equal(t, 1, dst, "the records of another share are none of this one's business")
}

// The store no longer holds the ciphertext once the last download has been
// handed over, which is not a reason to report a failure.
func TestDeleteStoredFileAcceptsAMissingFile(t *testing.T) {
	db, conf := setup(t)

	file := shareWithRecords(t, db, "never-written")

	assert.Empty(t, DeleteStoredFile(file, db, conf))
}

// The sweep clears what a database written before this held on to: rows that
// were marked deleted, and records left pointing at a share that is gone.
func TestCleanupClearsTheOldBacklog(t *testing.T) {
	db, conf := setup(t)

	file := shareWithRecords(t, db, "old")

	// the way a share used to be deleted: marked, with its records untouched
	require.NoError(t, db.Delete(file).Error)

	files, clients, dst := countRows(t, db)
	require.Equal(t, 1, files, "the row is still there, only marked")
	require.Equal(t, 1, clients)
	require.Equal(t, 2, dst)

	assert.Empty(t, Cleanup(db, conf))

	files, clients, dst = countRows(t, db)
	assert.Zero(t, files)
	assert.Zero(t, clients)
	assert.Zero(t, dst)
}

// A live share keeps its records: the owner reads them, and they go when it does.
func TestCleanupKeepsTheRecordsOfALiveShare(t *testing.T) {
	db, conf := setup(t)

	shareWithRecords(t, db, "live")

	assert.Empty(t, Cleanup(db, conf))

	files, clients, dst := countRows(t, db)
	assert.Equal(t, 1, files)
	assert.Equal(t, 1, clients)
	assert.Equal(t, 2, dst)
}

// An error report is not a download record and lives by its own retention, so a
// sweep for orphans must leave it alone.
func TestCleanupKeepsErrorReports(t *testing.T) {
	db, conf := setup(t)

	require.NoError(t, db.Create(&database.Stats{
		URL:    "https://example.org/d/broken",
		Client: &database.Client{Addr: "198.51.100.7"},
	}).Error)

	assert.Empty(t, Cleanup(db, conf))

	var reports int
	require.NoError(t, db.Model(&database.Stats{}).Count(&reports).Error)
	assert.Equal(t, 1, reports)
}
