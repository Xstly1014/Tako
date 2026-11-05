package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func (a API) registerNovelShelves(protected *gin.RouterGroup) {
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
		book, e := uuid.Parse(c.Param("id"))
		if e != nil || book == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return uuid.Nil, uuid.Nil, false
		}
		return c.MustGet("account").(identity.Account).ID, book, true
	}
	send := func(c *gin.Context, out any, e error) {
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	}
	protected.GET("/my/novel-shelf", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		out, e := s.Shelves(c.Request.Context(), c.MustGet("account").(identity.Account).ID, c.Query("cursor"))
		send(c, out, e)
	})
	protected.GET("/my/novel-shelf/:id", func(c *gin.Context) {
		reader, book, ok := scope(c)
		if !ok {
			return
		}
		out, e := s.ShelfState(c.Request.Context(), reader, book)
		send(c, out, e)
	})
	protected.POST("/my/novel-shelf/:id", func(c *gin.Context) {
		reader, book, ok := scope(c)
		if !ok {
			return
		}
		var in novel.ShelfWrite
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.WriteShelf(c.Request.Context(), reader, book, in)
		send(c, out, e)
	})
	protected.GET("/my/novel-shelf/:id/requests/:mutation", func(c *gin.Context) {
		reader, book, ok := scope(c)
		if !ok {
			return
		}
		mutation, e := uuid.Parse(c.Param("mutation"))
		if e != nil || mutation == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return
		}
		out, e := s.ShelfReceipt(c.Request.Context(), reader, book, mutation)
		send(c, out, e)
	})
}
