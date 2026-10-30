package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strconv"
	"strings"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func (a API) registerModeration(protected *gin.RouterGroup, s publication.Store, enabled func(*gin.Context) bool) {
	actor := func(c *gin.Context) uuid.UUID { return c.MustGet("account").(identity.Account).ID }
	gate := func(c *gin.Context) bool {
		if !enabled(c) {
			return false
		}
		id := actor(c)
		for _, raw := range strings.Split(a.OperatorAccounts, ",") {
			parsed, e := uuid.Parse(strings.TrimSpace(raw))
			if e == nil && parsed != uuid.Nil && parsed == id {
				return true
			}
		}
		respondError(c, 403, "operator_required")
		return false
	}
	number := func(c *gin.Context, key string, param bool) (uint64, bool) {
		raw := c.Query(key)
		if param {
			raw = c.Param(key)
		}
		if raw == "" && !param {
			return 0, true
		}
		n, e := strconv.ParseUint(raw, 10, 64)
		if e != nil || n > publication.MaxSequence || (param && n == 0) {
			publicationError(c, publication.ErrInvalid)
			return 0, false
		}
		return n, true
	}
	reply := func(c *gin.Context, v any, e error) {
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, v)
	}
	protected.GET("/ops/reviews", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		n, ok := number(c, "after", false)
		if !ok {
			return
		}
		v, e := s.Reviews(c.Request.Context(), n)
		reply(c, v, e)
	})
	protected.GET("/ops/reviews/:id/versions/:number", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		id, e := uuid.Parse(c.Param("id"))
		if e != nil || id == uuid.Nil {
			publicationError(c, publication.ErrNotFound)
			return
		}
		n, ok := number(c, "number", true)
		if !ok {
			return
		}
		v, e := s.ReviewDetail(c.Request.Context(), id, n)
		reply(c, v, e)
	})
	protected.POST("/ops/reviews/:id/versions/:number", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		id, e := uuid.Parse(c.Param("id"))
		if e != nil || id == uuid.Nil {
			publicationError(c, publication.ErrNotFound)
			return
		}
		n, ok := number(c, "number", true)
		if !ok {
			return
		}
		var in publication.ModerationAction
		if c.ShouldBindJSON(&in) != nil {
			publicationError(c, publication.ErrInvalid)
			return
		}
		v, e := s.Review(c.Request.Context(), actor(c), id, n, in)
		reply(c, v, e)
	})
	protected.GET("/my/moderation", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		n, ok := number(c, "before", false)
		if !ok {
			return
		}
		v, e := s.Cases(c.Request.Context(), actor(c), n)
		reply(c, v, e)
	})
	protected.GET("/ops/moderation", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		n, ok := number(c, "before", false)
		if !ok {
			return
		}
		v, e := s.Cases(c.Request.Context(), uuid.Nil, n)
		reply(c, v, e)
	})
	protected.GET("/ops/appeals", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		n, ok := number(c, "after", false)
		if !ok {
			return
		}
		v, e := s.Appeals(c.Request.Context(), 0, n, true)
		reply(c, v, e)
	})
	for _, operator := range []bool{false, true} {
		prefix := "/my/moderation/:number"
		if operator {
			prefix = "/ops/moderation/:number"
		}
		protected.GET(prefix, func(c *gin.Context) {
			if operator {
				if !gate(c) {
					return
				}
			} else if !enabled(c) {
				return
			}
			n, ok := number(c, "number", true)
			if !ok {
				return
			}
			before, ok := number(c, "before", false)
			if !ok {
				return
			}
			var owner *uuid.UUID
			if !operator {
				o := actor(c)
				owner = &o
			}
			v, e := s.ModerationCase(c.Request.Context(), owner, n, before)
			reply(c, v, e)
		})
		protected.POST(prefix, func(c *gin.Context) {
			if operator {
				if !gate(c) {
					return
				}
			} else if !enabled(c) {
				return
			}
			n, ok := number(c, "number", true)
			if !ok {
				return
			}
			var in publication.ModerationAction
			if c.ShouldBindJSON(&in) != nil {
				publicationError(c, publication.ErrInvalid)
				return
			}
			var v publication.ModerationResult
			var e error
			if operator {
				v, e = s.DecideCase(c.Request.Context(), actor(c), n, in)
			} else {
				if in.Decision != "appeal" {
					publicationError(c, publication.ErrInvalid)
					return
				}
				v, e = s.Appeal(c.Request.Context(), actor(c), n, in)
			}
			reply(c, v, e)
		})
	}
}
