package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/novel"
)

func (a API) registerNovelReading(api *gin.RouterGroup) {
	s := novel.Store{DB: a.DB}
	enabled := func(c *gin.Context) bool {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return false
		}
		return true
	}
	target := func(c *gin.Context, name string) (uuid.UUID, bool) {
		id, e := uuid.Parse(c.Param(name))
		if e != nil || id == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return uuid.Nil, false
		}
		return id, true
	}
	send := func(c *gin.Context, out any, e error) {
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	}
	api.GET("/novels", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		out, e := s.PublicNovels(c.Request.Context(), c.Query("cursor"))
		send(c, out, e)
	})
	api.GET("/novels/:id", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		id, ok := target(c, "id")
		if !ok {
			return
		}
		out, e := s.PublicNovel(c.Request.Context(), id)
		send(c, out, e)
	})
	api.GET("/novels/:id/directory", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		id, ok := target(c, "id")
		if !ok {
			return
		}
		out, e := s.Directory(c.Request.Context(), id, c.Query("cursor"))
		send(c, out, e)
	})
	api.GET("/novels/:id/chapters/:chapter", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		id, ok := target(c, "id")
		if !ok {
			return
		}
		chapter, ok := target(c, "chapter")
		if !ok {
			return
		}
		out, e := s.PublicChapter(c.Request.Context(), id, chapter)
		send(c, out, e)
	})
}
