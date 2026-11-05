package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func (a API) registerNovelNotices(protected *gin.RouterGroup) {
	s := novel.Store{DB: a.DB}
	enabled := func(c *gin.Context) bool {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return false
		}
		return true
	}
	scope := func(c *gin.Context) (uuid.UUID, uuid.UUID, bool) {
		if !enabled(c) {
			return uuid.Nil, uuid.Nil, false
		}
		id, e := uuid.Parse(c.Param("id"))
		if e != nil || id == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return uuid.Nil, uuid.Nil, false
		}
		return c.MustGet("account").(identity.Account).ID, id, true
	}
	send := func(c *gin.Context, out any, e error) {
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	}
	protected.GET("/my/novel-notices", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		out, e := s.NovelNotices(c.Request.Context(), c.MustGet("account").(identity.Account).ID, c.Query("cursor"))
		send(c, out, e)
	})
	protected.GET("/my/novel-notices/:id", func(c *gin.Context) {
		reader, id, ok := scope(c)
		if !ok {
			return
		}
		out, e := s.NovelNoticeDetail(c.Request.Context(), reader, id, c.Query("cursor"))
		send(c, out, e)
	})
	protected.POST("/my/novel-notices/:id/read", func(c *gin.Context) {
		reader, id, ok := scope(c)
		if !ok {
			return
		}
		var input map[string]any
		if c.ShouldBindJSON(&input) != nil || input == nil || len(input) != 0 {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.ReadNovelNotice(c.Request.Context(), reader, id)
		send(c, out, e)
	})
}
