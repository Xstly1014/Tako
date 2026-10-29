package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"log/slog"
	"time"
	"writing.local/community/internal/ops"
)

func requestLog(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := uuid.NewString()
		c.Set("request_id", id)
		c.Header("X-Request-ID", id)
		start := time.Now()
		c.Next()
		ops.RecordRequest(c.Writer.Status())
		if logger == nil {
			return
		}
		// Never log raw URL/query, headers, bodies, SQL arguments or arbitrary errors.
		logger.Info("http_request", "request_id", id, "delivery_id", c.GetString("delivery_id"), "method", c.Request.Method, "route", c.FullPath(), "status", c.Writer.Status(), "duration_ms", time.Since(start).Milliseconds(), "error_code", c.GetString("error_code"))
	}
}
func respondError(c *gin.Context, status int, code string) {
	c.Set("error_code", code)
	c.AbortWithStatusJSON(status, gin.H{"error": code, "request_id": c.GetString("request_id")})
}
