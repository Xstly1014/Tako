package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strconv"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func (a API) registerAuthorPolicy(g *gin.RouterGroup) {
	s := novel.Store{DB: a.DB}
	scope := func(c *gin.Context, ops bool) (uuid.UUID, uuid.UUID, bool) {
		actor := c.MustGet("account").(identity.Account).ID
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return actor, uuid.Nil, false
		}
		if ops && !a.isOperator(actor) {
			respondError(c, 403, "operator_required")
			return actor, uuid.Nil, false
		}
		book, e := uuid.Parse(c.Param("id"))
		if e != nil || book == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return actor, book, false
		}
		return actor, book, true
	}
	for _, ops := range []bool{false, true} {
		ops := ops
		root := "/my/novels/:id/author-policy"
		if ops {
			root = "/ops/novels/:id/author-policy"
		}
		g.GET(root, func(c *gin.Context) {
			actor, book, ok := scope(c, ops)
			if !ok {
				return
			}
			before, e := strconv.ParseUint(c.DefaultQuery("before", "0"), 10, 64)
			if e != nil {
				novelError(c, novel.ErrInvalid)
				return
			}
			if ops {
				actor = uuid.Nil
			}
			out, e := s.AuthorPolicyFor(c.Request.Context(), actor, book, before)
			if e != nil {
				novelError(c, e)
				return
			}
			c.JSON(200, out)
		})
	}
	g.POST("/ops/novels/:id/author-policy", func(c *gin.Context) {
		actor, book, ok := scope(c, true)
		if !ok {
			return
		}
		var in novel.AuthorPolicyAction
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.ChangeAuthorPolicy(c.Request.Context(), actor, book, in)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	g.GET("/ops/novels/:id/author-policy/requests/:mutation", func(c *gin.Context) {
		actor, book, ok := scope(c, true)
		if !ok {
			return
		}
		m, e := uuid.Parse(c.Param("mutation"))
		if e != nil || m == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return
		}
		out, e := s.AuthorPolicyReceipt(c.Request.Context(), actor, book, m)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	g.GET("/my/author-policy", func(c *gin.Context) {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return
		}
		before, e := strconv.ParseUint(c.DefaultQuery("before", "0"), 10, 64)
		if e != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.AuthorPolicyFor(c.Request.Context(), c.MustGet("account").(identity.Account).ID, uuid.Nil, before)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	g.GET("/ops/works/:id/author-policy", func(c *gin.Context) {
		actor, id, ok := scope(c, true)
		_ = actor
		if !ok {
			return
		}
		before, e := strconv.ParseUint(c.DefaultQuery("before", "0"), 10, 64)
		if e != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.AuthorPolicyForContext(c.Request.Context(), uuid.Nil, id, "work", before)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	g.POST("/ops/works/:id/author-policy", func(c *gin.Context) {
		actor, id, ok := scope(c, true)
		if !ok {
			return
		}
		var in novel.AuthorPolicyAction
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.ChangeAuthorPolicyForContext(c.Request.Context(), actor, id, "work", in)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	g.GET("/ops/works/:id/author-policy/requests/:mutation", func(c *gin.Context) {
		actor, id, ok := scope(c, true)
		if !ok {
			return
		}
		m, e := uuid.Parse(c.Param("mutation"))
		if e != nil || m == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return
		}
		out, e := s.AuthorPolicyReceiptForContext(c.Request.Context(), actor, id, m, "work")
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})

}
