package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strings"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func (a API) isOperator(id uuid.UUID) bool {
	for _, raw := range strings.Split(a.OperatorAccounts, ",") {
		parsed, e := uuid.Parse(strings.TrimSpace(raw))
		if e == nil && parsed != uuid.Nil && parsed == id {
			return true
		}
	}
	return false
}

func (a API) registerDiscovery(api, protected *gin.RouterGroup) {
	s := publication.Store{DB: a.DB}
	enabled := func(c *gin.Context) bool {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return false
		}
		return true
	}
	reply := func(c *gin.Context, out any, e error) {
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	}
	gate := func(c *gin.Context) bool {
		if !enabled(c) {
			return false
		}
		if !a.isOperator(c.MustGet("account").(identity.Account).ID) {
			respondError(c, 403, "operator_required")
			return false
		}
		return true
	}
	api.GET("/community", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		out, e := s.Discover(c.Request.Context(), c.Query("tag"), c.Query("cursor"))
		reply(c, out, e)
	})
	protected.GET("/me/access", func(c *gin.Context) {
		c.JSON(200, gin.H{"operator": a.EnablePublications && a.isOperator(c.MustGet("account").(identity.Account).ID)})
	})
	protected.GET("/ops/curation", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		out, e := s.Curations(c.Request.Context())
		reply(c, out, e)
	})
	protected.GET("/ops/curation/:id", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		id, e := uuid.Parse(c.Param("id"))
		if e != nil || id == uuid.Nil {
			publicationError(c, publication.ErrNotFound)
			return
		}
		out, e := s.CurationCandidate(c.Request.Context(), id)
		reply(c, out, e)
	})
	protected.POST("/ops/curation", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		var in publication.CurationChange
		if c.ShouldBindJSON(&in) != nil {
			publicationError(c, publication.ErrInvalid)
			return
		}
		out, e := s.ChangeCuration(c.Request.Context(), c.MustGet("account").(identity.Account).ID, in)
		reply(c, out, e)
	})
}
