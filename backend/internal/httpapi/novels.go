package httpapi

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func novelError(c *gin.Context, err error) {
	status, code := 503, "service_unavailable"
	switch {
	case errors.Is(err, novel.ErrPreviewExpired):
		status, code = 410, "chapter_preview_expired"
	case errors.Is(err, novel.ErrPublicationConflict):
		status, code = 409, "chapter_publication_conflict"
	case errors.Is(err, novel.ErrSourceUnavailable):
		status, code = 409, "source_revision_unavailable"
	case errors.Is(err, novel.ErrNickname):
		status, code = 409, "nickname_required"
	case errors.Is(err, novel.ErrPublicationLimited):
		status, code = 429, "rate_limited"
		c.Header("Retry-After", "3600")
	case errors.Is(err, novel.ErrInvalid):
		status, code = 400, "invalid_input"
	case errors.Is(err, novel.ErrNotFound):
		status, code = 404, "resource_not_found"
	case errors.Is(err, novel.ErrConflict):
		status, code = 409, "novel_revision_conflict"
	case errors.Is(err, novel.ErrKeyReuse):
		status, code = 409, "mutation_id_reused"
	}
	respondError(c, status, code)
}
func (a API) registerNovels(protected *gin.RouterGroup) {
	s := novel.Store{DB: a.DB}
	protected.GET("/my/novels", func(c *gin.Context) {
		out, err := s.List(c.Request.Context(), c.MustGet("account").(identity.Account).ID, c.Query("cursor"))
		if err != nil {
			novelError(c, err)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/novels/:id", func(c *gin.Context) {
		id, e := uuid.Parse(c.Param("id"))
		if e != nil {
			novelError(c, novel.ErrNotFound)
			return
		}
		out, err := s.Read(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id)
		if err != nil {
			novelError(c, err)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/novel-mutations/:id", func(c *gin.Context) {
		id, e := uuid.Parse(c.Param("id"))
		if e != nil {
			novelError(c, novel.ErrNotFound)
			return
		}
		out, err := s.Receipt(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id)
		if err != nil {
			novelError(c, err)
			return
		}
		c.JSON(200, out)
	})
	write := func(update bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			account := c.MustGet("account").(identity.Account)
			if account.Nickname == "" {
				respondError(c, 409, "nickname_required")
				return
			}
			id := uuid.Nil
			if update {
				var e error
				id, e = uuid.Parse(c.Param("id"))
				if e != nil || id == uuid.Nil {
					novelError(c, novel.ErrNotFound)
					return
				}
			}
			var in novel.Write
			if c.ShouldBindJSON(&in) != nil {
				novelError(c, novel.ErrInvalid)
				return
			}
			out, err := s.Write(c.Request.Context(), account.ID, id, in)
			if err != nil {
				novelError(c, err)
				return
			}
			c.JSON(200, out)
		}
	}
	protected.POST("/my/novels", write(false))
	protected.POST("/my/novels/:id", write(true))
}
