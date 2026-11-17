package httpapi

import (
	"database/sql"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strconv"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/shortpost"
)

func (a API) registerShortPostReports(r *gin.RouterGroup) {
	s := shortpost.PostStore{DB: a.DB}
	enabled := func(c *gin.Context) bool {
		if a.EnvironmentName != "test" || !a.EnablePublications || a.DB == nil {
			respondError(c, 503, "publication_disabled")
			return false
		}
		return true
	}
	operator := func(c *gin.Context) bool {
		if !enabled(c) {
			return false
		}
		if !a.isOperator(c.MustGet("account").(identity.Account).ID) {
			respondError(c, 403, "operator_required")
			return false
		}
		return true
	}

	actor := func(c *gin.Context) uuid.UUID { return c.MustGet("account").(identity.Account).ID }
	number := func(c *gin.Context, name string, query bool) (uint64, bool) {
		raw := c.Param(name)
		if query {
			raw = c.DefaultQuery(name, "0")
		}
		n, e := strconv.ParseUint(raw, 10, 64)
		if e != nil || n > 9007199254740991 || (!query && n == 0) {
			shortPostError(c, shortpost.ErrInvalidAction)
			return 0, false
		}
		return n, true
	}
	send := func(c *gin.Context, v any, e error) {
		if e != nil {
			shortPostError(c, e)
			return
		}
		c.JSON(200, v)
	}
	r.POST("/short-posts/:id/versions/:number/reports", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		work, e := uuid.Parse(c.Param("id"))
		if e != nil || work == uuid.Nil {
			shortPostError(c, sql.ErrNoRows)
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
			shortPostError(c, shortpost.ErrInvalidAction)
			return
		}
		out, e := s.CreateContentReport(c.Request.Context(), actor(c), work, version, in.Reason)
		send(c, out, e)
	})
	for _, ops := range []bool{false, true} {
		prefix := "/my/short-post-reports"
		if ops {
			prefix = "/ops/short-post-reports"
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
	r.POST("/ops/short-post-reports/:number", func(c *gin.Context) {
		if !operator(c) {
			return
		}
		id, ok := number(c, "number", false)
		if !ok {
			return
		}
		var in shortpost.ReportDecision
		if c.ShouldBindJSON(&in) != nil {
			shortPostError(c, shortpost.ErrInvalidAction)
			return
		}
		out, e := s.ResolveContentReport(c.Request.Context(), actor(c), id, in)
		send(c, out, e)
	})
	r.GET("/ops/short-post-reports/:number/evidence", func(c *gin.Context) {
		if !operator(c) {
			return
		}
		id, ok := number(c, "number", false)
		if !ok {
			return
		}
		out, e := s.ReportEvidence(c.Request.Context(), id)
		send(c, out, e)
	})
	r.GET("/ops/short-post-reports/:number/evidence/images/:imageId", func(c *gin.Context) {
		if !operator(c) {
			return
		}
		id, ok := number(c, "number", false)
		if !ok {
			return
		}
		image, e := uuid.Parse(c.Param("imageId"))
		if e != nil || image == uuid.Nil {
			shortPostError(c, sql.ErrNoRows)
			return
		}
		media, body, e := s.ReportEvidenceImage(c.Request.Context(), id, image)
		if e != nil {
			shortPostError(c, e)
			return
		}
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(200, media, body)
	})

}
