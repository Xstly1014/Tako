package httpapi

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func (a API) registerWorkManagement(api, protected *gin.RouterGroup, s publication.Store, enabled func(*gin.Context) bool) {
	id := func(c *gin.Context) (uuid.UUID, bool) {
		value, e := uuid.Parse(c.Param("id"))
		if e != nil || value == uuid.Nil {
			publicationError(c, publication.ErrNotFound)
			return uuid.Nil, false
		}
		return value, true
	}
	cursors := func(c *gin.Context) (uint64, uint64, bool) {
		var out [2]uint64
		for i, name := range []string{"before_version", "before_event"} {
			raw := c.Query(name)
			if raw == "" {
				continue
			}
			n, e := strconv.ParseUint(raw, 10, 64)
			if e != nil || n > publication.MaxSequence {
				publicationError(c, publication.ErrInvalid)
				return 0, 0, false
			}
			out[i] = n
		}
		return out[0], out[1], true
	}
	owner := func(c *gin.Context) uuid.UUID { return c.MustGet("account").(identity.Account).ID }
	protected.GET("/my/works", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		out, e := s.AuthorWorks(c.Request.Context(), owner(c), c.Query("cursor"))
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/works/:id", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		value, ok := id(c)
		if !ok {
			return
		}
		out, e := s.AuthorState(c.Request.Context(), owner(c), value)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/works/:id/versions", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		value, ok := id(c)
		if !ok {
			return
		}
		v, event, ok := cursors(c)
		if !ok {
			return
		}
		out, e := s.AuthorTimeline(c.Request.Context(), owner(c), value, v, event)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/works/:id/versions/:number", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		value, ok := id(c)
		if !ok {
			return
		}
		n, e := strconv.ParseUint(c.Param("number"), 10, 64)
		if e != nil || n == 0 || n > publication.MaxSequence {
			publicationError(c, publication.ErrNotFound)
			return
		}
		out, e := s.AuthorVersion(c.Request.Context(), owner(c), value, n)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.POST("/my/works/:id/actions", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		value, ok := id(c)
		if !ok {
			return
		}
		var in publication.Change
		if c.ShouldBindJSON(&in) != nil {
			publicationError(c, publication.ErrInvalid)
			return
		}
		out, e := s.Change(c.Request.Context(), owner(c), value, in)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	api.GET("/works/:id/timeline", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		value, ok := id(c)
		if !ok {
			return
		}
		v, event, ok := cursors(c)
		if !ok {
			return
		}
		out, e := s.Timeline(c.Request.Context(), value, v, event)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
}
