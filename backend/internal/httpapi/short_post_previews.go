package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
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
	books := novel.Store{DB: a.DB}
	protected.GET("/my/short-post-novel-options", a.shortPostTestOnly, func(c *gin.Context) {
		owner := c.MustGet("account").(identity.Account)
		page, err := books.OwnedPublicNovels(c.Request.Context(), owner.ID, c.Query("cursor"))
		if err != nil {
			novelError(c, err)
			return
		}
		c.JSON(200, page)
	})
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
	if err != nil {
		shortPostError(c, err)
		return
	}
	c.JSON(200, out)
}
