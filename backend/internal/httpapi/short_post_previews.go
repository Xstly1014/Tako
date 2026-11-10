package httpapi

import (
	"database/sql"
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/shortpost"
)

func (a API) shortPostTestOnly(c *gin.Context) {
	// Enable the service in the isolated test environment while the complete publishing flow is built.
	if a.EnvironmentName != "test" || !a.EnablePublications || a.DB == nil {
		respondError(c, 503, "publication_disabled")
		return
	}
	c.Next()
}

func (a API) registerShortPostPreviews(protected *gin.RouterGroup) {
	store := shortpost.PreviewStore{DB: a.DB}
	previews := protected.Group("/my/short-post-previews/:id", a.shortPostTestOnly)
	previews.PUT("", func(c *gin.Context) {
		owner := c.MustGet("account").(identity.Account)
		if owner.Nickname == "" {
			respondError(c, 409, "nickname_required")
			return
		}
		id, err := uuid.Parse(c.Param("id"))
		var in shortpost.PreparePreview
		if err != nil || id == uuid.Nil || c.ShouldBindJSON(&in) != nil {
			respondError(c, 400, "invalid_input")
			return
		}
		out, err := store.Prepare(c.Request.Context(), owner.ID, id, in)
		sendShortPostPreview(c, out, err)
	})
	previews.GET("", func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil || id == uuid.Nil {
			respondError(c, 404, "resource_not_found")
			return
		}
		owner := c.MustGet("account").(identity.Account)
		out, err := store.Read(c.Request.Context(), owner.ID, id)
		sendShortPostPreview(c, out, err)
	})
}

func sendShortPostPreview(c *gin.Context, out shortpost.Preview, err error) {
	switch {
	case err == nil:
		c.JSON(200, out)
	case errors.Is(err, shortpost.ErrInvalidPreview):
		respondError(c, 400, "invalid_input")
	case errors.Is(err, shortpost.ErrPreviewIDReused):
		respondError(c, 409, "mutation_id_reused")
	case errors.Is(err, shortpost.ErrImageUnavailable):
		respondError(c, 409, "short_post_image_unavailable")
	case errors.Is(err, shortpost.ErrNovelUnavailable):
		respondError(c, 409, "short_post_novel_unavailable")
	case errors.Is(err, shortpost.ErrPreviewQuota):
		respondError(c, 409, "short_post_preview_quota_reached")
	case errors.Is(err, shortpost.ErrPreviewExpired):
		respondError(c, 410, "preview_expired")
	case errors.Is(err, sql.ErrNoRows):
		respondError(c, 404, "resource_not_found")
	default:
		respondError(c, 503, "service_unavailable")
	}
}
