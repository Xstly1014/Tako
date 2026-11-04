package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func (a API) registerNovelReadingPosition(protected *gin.RouterGroup) {
	s := novel.Store{DB: a.DB}
	scope := func(c *gin.Context) (uuid.UUID, uuid.UUID, bool) {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
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
	root := "/my/novel-reading/:id"
	protected.GET(root, func(c *gin.Context) {
		reader, book, ok := scope(c)
		if !ok {
			return
		}
		out, e := s.ReadingState(c.Request.Context(), reader, book)
		send(c, out, e)
	})
	protected.POST(root, func(c *gin.Context) {
		reader, book, ok := scope(c)
		if !ok {
			return
		}
		var in novel.ReadingWrite
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.SaveReading(c.Request.Context(), reader, book, in)
		send(c, out, e)
	})
	protected.GET(root+"/requests/:mutation", func(c *gin.Context) {
		reader, book, ok := scope(c)
		if !ok {
			return
		}
		mutation, e := uuid.Parse(c.Param("mutation"))
		if e != nil || mutation == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return
		}
		out, e := s.ReadingReceipt(c.Request.Context(), reader, book, mutation)
		send(c, out, e)
	})
}
