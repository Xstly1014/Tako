package httpapi

import (
	"database/sql"
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/shortpost"
)

func (a API) registerShortPosts(api, protected *gin.RouterGroup) {
	store := shortpost.PostStore{DB: a.DB}
	submissions := protected.Group("/my/short-post-submissions/:id", a.shortPostTestOnly)
	submissions.PUT("", func(c *gin.Context) {
		owner := c.MustGet("account").(identity.Account)
		if owner.Nickname == "" {
			respondError(c, 409, "nickname_required")
			return
		}
		id, err := uuid.Parse(c.Param("id"))
		var in shortpost.SubmitPost
		if err != nil || id == uuid.Nil || c.ShouldBindJSON(&in) != nil {
			respondError(c, 400, "invalid_input")
			return
		}
		out, err := store.Submit(c.Request.Context(), owner.ID, id, in)
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	submissions.GET("", func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil || id == uuid.Nil {
			respondError(c, 404, "resource_not_found")
			return
		}
		owner := c.MustGet("account").(identity.Account).ID
		out, err := store.Receipt(c.Request.Context(), owner, id)
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	posts := api.Group("/short-posts/:id", a.shortPostTestOnly)
	posts.GET("", func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil || id == uuid.Nil {
			respondError(c, 404, "resource_not_found")
			return
		}
		out, err := store.Public(c.Request.Context(), id)
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	posts.GET("/versions/1/images/:imageId", func(c *gin.Context) {
		post, postErr := uuid.Parse(c.Param("id"))
		image, imageErr := uuid.Parse(c.Param("imageId"))
		if postErr != nil || imageErr != nil || post == uuid.Nil || image == uuid.Nil {
			respondError(c, 404, "resource_not_found")
			return
		}
		mediaType, content, err := store.PublicImage(c.Request.Context(), post, image)
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(200, mediaType, content)
	})
}

func shortPostError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, shortpost.ErrInvalidPreview), errors.Is(err, shortpost.ErrInvalidSubmission):
		respondError(c, 400, "invalid_input")
	case errors.Is(err, shortpost.ErrPreviewIDReused):
		respondError(c, 409, "mutation_id_reused")
	case errors.Is(err, shortpost.ErrAlreadySubmitted):
		respondError(c, 409, "publication_conflict")
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
