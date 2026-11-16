package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strconv"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func (a API) registerContentReports(r *gin.RouterGroup, s publication.Store, enabled, operator func(*gin.Context) bool) {
	actor := func(c *gin.Context) uuid.UUID { return c.MustGet("account").(identity.Account).ID }
	number := func(c *gin.Context, name string, query bool) (uint64, bool) {
		raw := c.Param(name)
		if query {
			raw = c.DefaultQuery(name, "0")
		}
		n, e := strconv.ParseUint(raw, 10, 64)
		if e != nil || n > publication.MaxSequence || (!query && n == 0) {
			publicationError(c, publication.ErrInvalid)
			return 0, false
		}
		return n, true
	}
	send := func(c *gin.Context, v any, e error) {
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, v)
	}
	r.POST("/works/:id/versions/:number/reports", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		work, e := uuid.Parse(c.Param("id"))
		if e != nil || work == uuid.Nil {
			publicationError(c, publication.ErrNotFound)
			return
		}
		version, ok := number(c, "number", false)
		if !ok {
			return
		}
		var in struct {
			Reason string `json:"reason"`
		}
		if c.ShouldBindJSON(&in) != nil {
			publicationError(c, publication.ErrInvalid)
			return
		}
		out, e := s.CreateContentReport(c.Request.Context(), actor(c), work, version, in.Reason)
		send(c, out, e)
	})
	for _, ops := range []bool{false, true} {
		prefix := "/my/content-reports"
		if ops {
			prefix = "/ops/content-reports"
		}
		gate := func(c *gin.Context) bool {
			if ops {
				return operator(c)
			}
			return enabled(c)
		}
		r.GET(prefix, func(c *gin.Context) {
			if !gate(c) {
				return
			}
			before, ok := number(c, "before", true)
			if !ok {
				return
			}
			var owner *uuid.UUID
			if !ops {
				id := actor(c)
				owner = &id
			}
			out, e := s.ContentReports(c.Request.Context(), owner, before, c.DefaultQuery("state", "all"))
			send(c, out, e)
		})
		r.GET(prefix+"/:number", func(c *gin.Context) {
			if !gate(c) {
				return
			}
			id, ok := number(c, "number", false)
			if !ok {
				return
			}
			var owner *uuid.UUID
			if !ops {
				v := actor(c)
				owner = &v
			}
			out, e := s.ContentReport(c.Request.Context(), owner, id)
			send(c, out, e)
		})
	}
	r.POST("/ops/content-reports/:number", func(c *gin.Context) {
		if !operator(c) {
			return
		}
		id, ok := number(c, "number", false)
		if !ok {
			return
		}
		var in publication.ReportDecision
		if c.ShouldBindJSON(&in) != nil {
			publicationError(c, publication.ErrInvalid)
			return
		}
		out, e := s.ResolveContentReport(c.Request.Context(), actor(c), id, in)
		send(c, out, e)
	})
}
