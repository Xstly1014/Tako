package httpapi

import (
	"errors"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func publicationError(c *gin.Context, e error) {
	status, code := 503, "service_unavailable"
	switch {
	case errors.Is(e, publication.ErrReviewConflict):
		status, code = 409, "review_conflict"
	case errors.Is(e, publication.ErrAppealPending):
		status, code = 409, "appeal_pending"
	case errors.Is(e, publication.ErrAppealCooldown):
		status, code = 409, "appeal_cooldown"
	case errors.Is(e, publication.ErrInvalid):
		status, code = 400, "invalid_input"
	case errors.Is(e, publication.ErrNotFound):
		status, code = 404, "resource_not_found"
	case errors.Is(e, publication.ErrExpired):
		status, code = 410, "preview_expired"
	case errors.Is(e, publication.ErrKeyReuse):
		status, code = 409, "mutation_id_reused"
	case errors.Is(e, publication.ErrSource):
		status, code = 409, "source_revision_unavailable"
	case errors.Is(e, publication.ErrStateConflict):
		status, code = 409, "work_state_conflict"
	case errors.Is(e, publication.ErrVersionUnavailable):
		status, code = 409, "version_unavailable"
	case errors.Is(e, publication.ErrWorkRestricted):
		status, code = 409, "work_restricted"
	case errors.Is(e, publication.ErrConflict):
		status, code = 409, "publication_conflict"
	case errors.Is(e, publication.ErrUnsupported):
		status, code = 409, "unsupported_publication_state"
	case errors.Is(e, publication.ErrNickname):
		status, code = 409, "nickname_required"
	case errors.Is(e, publication.ErrLimited):
		status, code = 429, "rate_limited"
		c.Header("Retry-After", "3600")
	}
	respondError(c, status, code)
}
func (a API) registerPublicationRoutes(api, protected *gin.RouterGroup) {
	s := publication.Store{DB: a.DB}
	enabled := func(c *gin.Context) bool {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return false
		}
		return true
	}
	protected.POST("/publication-previews", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		var in publication.Prepare
		if c.ShouldBindJSON(&in) != nil {
			publicationError(c, publication.ErrInvalid)
			return
		}
		owner := c.MustGet("account").(identity.Account).ID
		out, e := s.Prepare(c.Request.Context(), owner, in)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/publication-previews/:id", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		id, e := uuid.Parse(c.Param("id"))
		if e != nil {
			publicationError(c, publication.ErrNotFound)
			return
		}
		out, e := s.ReadPreview(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.POST("/publications", func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		var in publication.Publish
		if c.ShouldBindJSON(&in) != nil {
			publicationError(c, publication.ErrInvalid)
			return
		}
		out, e := s.Publish(c.Request.Context(), c.MustGet("account").(identity.Account).ID, in)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	read := func(c *gin.Context) {
		if !enabled(c) {
			return
		}
		id, e := uuid.Parse(c.Param("id"))
		if e != nil {
			publicationError(c, publication.ErrNotFound)
			return
		}
		var version uint64
		if raw := c.Param("number"); raw != "" {
			version, e = strconv.ParseUint(raw, 10, 64)
			if e != nil || version == 0 || version > publication.MaxSequence {
				publicationError(c, publication.ErrNotFound)
				return
			}
		}
		out, e := s.Read(c.Request.Context(), id, version)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	}
	api.GET("/works/:id", read)
	api.GET("/works/:id/versions/:number", read)
	a.registerWorkManagement(api, protected, s, enabled)
	a.registerModeration(protected, s, enabled)
}
