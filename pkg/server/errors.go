package server

import (
	"github.com/gin-gonic/gin"
)

// ErrorCode is a stable, machine readable identifier for an error response.
// Clients use it to look up a localized message and fall back to the English
// message field when they don't know the code, so codes must never be renamed
// or reused for a different meaning once released. Adding a new one only means
// adding a constant here and a matching entry in the client locale files.
type ErrorCode string

const (
	// upload
	ErrCodeInvalidUpload    ErrorCode = "invalid_upload"
	ErrCodeTempFilename     ErrorCode = "temp_filename_failed"
	ErrCodeFileIDFailed     ErrorCode = "file_id_failed"
	ErrCodeOwnerTokenFailed ErrorCode = "owner_token_failed"
	ErrCodeTransactionStart ErrorCode = "transaction_start_failed"
	ErrCodeStoreFailed      ErrorCode = "store_failed"
	ErrCodeSaveFailed       ErrorCode = "save_failed"

	// download
	ErrCodeInvalidFileID     ErrorCode = "invalid_file_id"
	ErrCodeCountExpired      ErrorCode = "download_count_expired"
	ErrCodeFileNotFound      ErrorCode = "file_not_found"
	ErrCodeNotYetDownloadble ErrorCode = "file_not_yet_downloadable"
	ErrCodeLocationForbidden ErrorCode = "download_location_forbidden"
	ErrCodeFileGone          ErrorCode = "file_not_found_or_limit_exceeded"
	ErrCodeRetrievalFailed   ErrorCode = "file_retrieval_failed"

	// deletion
	ErrCodeOwnerTokenMismatch ErrorCode = "owner_token_mismatch"
	ErrCodeDeleteFailed       ErrorCode = "file_deletion_failed"

	// prolonging
	ErrCodeFileExpired   ErrorCode = "file_expired"
	ErrCodeProlongLimit  ErrorCode = "prolong_limit_exceeded"
	ErrCodeProlongFailed ErrorCode = "file_prolong_failed"

	// shared
	ErrCodeTLSRequirements ErrorCode = "tls_requirements_not_met"
	ErrCodeRateLimited     ErrorCode = "rate_limit_exceeded"
	ErrCodeInvalidRequest  ErrorCode = "invalid_request"
	ErrCodeStatsFailed     ErrorCode = "stats_store_failed"
)

// apiError writes an error response carrying both the stable code and the
// English message. Clients that know the code translate it, the rest keep
// showing the message.
func apiError(c *gin.Context, status int, code ErrorCode, message string) {
	c.JSON(
		status,
		gin.H{
			"code":    code,
			"message": message,
		},
	)
}

// apiErrorAborted writes an error response and stops the handler chain, for
// middleware that must not let the request continue.
func apiErrorAborted(c *gin.Context, status int, code ErrorCode, message string) {
	c.AbortWithStatusJSON(
		status,
		gin.H{
			"code":    code,
			"message": message,
		},
	)
}
