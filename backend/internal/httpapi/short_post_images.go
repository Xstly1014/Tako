package httpapi

import (
	"database/sql"
	"errors"
	"io"
	"mime"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/shortpost"
)

const shortImageRoute = "/my/short-post-images/:id"

func (a API) registerShortPostImages(protected *gin.RouterGroup) {
	store := shortpost.ImageStore{DB: a.DB}
	uploadSlots := make(chan struct{}, 2)
	images := protected.Group(shortImageRoute, a.shortPostTestOnly)
	images.PUT("", func(c *gin.Context) {
		owner := c.MustGet("account").(identity.Account)
		if owner.Nickname == "" {
			respondError(c, 409, "nickname_required")
			return
		}
		id, err := uuid.Parse(c.Param("id"))
		if err != nil || id == uuid.Nil {
			respondError(c, 400, "invalid_input")
			return
		}
		mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || (mediaType != "image/jpeg" && mediaType != "image/png") {
			respondError(c, 415, "image_type_unsupported")
			return
		}
		if c.Request.ContentLength > shortpost.MaxImageBytes {
			respondError(c, 413, "payload_too_large")
			return
		}
		select {
		case uploadSlots <- struct{}{}:
			defer func() { <-uploadSlots }()
		default:
			c.Header("Retry-After", "2")
			respondError(c, 429, "image_upload_busy")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, shortpost.MaxImageBytes))
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				respondError(c, 413, "payload_too_large")
			} else {
				respondError(c, 400, "invalid_image")
			}
			return
		}
		result, err := store.Save(c.Request.Context(), owner.ID, id, mediaType, body)
		switch {
		case err == nil:
			c.JSON(200, result)
		case errors.Is(err, shortpost.ErrInvalidImage):
			respondError(c, 400, "invalid_image")
		case errors.Is(err, shortpost.ErrImageTooLarge):
			respondError(c, 413, "image_too_large")
		case errors.Is(err, shortpost.ErrImageQuota):
			respondError(c, 409, "image_quota_reached")
		case errors.Is(err, shortpost.ErrUploadIDReused):
			respondError(c, 409, "mutation_id_reused")
		default:
			respondError(c, 503, "service_unavailable")
		}
	})
	images.GET("", func(c *gin.Context) {
		owner := c.MustGet("account").(identity.Account)
		id, err := uuid.Parse(c.Param("id"))
		if err != nil || id == uuid.Nil {
			respondError(c, 404, "resource_not_found")
			return
		}
		mediaType, content, err := store.Read(c.Request.Context(), owner.ID, id)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			respondError(c, 404, "resource_not_found")
		case err != nil:
			respondError(c, 503, "service_unavailable")
		default:
			c.Header("X-Content-Type-Options", "nosniff")
			c.Data(200, mediaType, content)
		}
	})
}
