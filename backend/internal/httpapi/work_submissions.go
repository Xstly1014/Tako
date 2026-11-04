package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func (a API) registerWorkSubmissions(g *gin.RouterGroup) {
	s := publication.Store{DB: a.DB}
	gate := func(c *gin.Context, ops bool) bool {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return false
		}
		if ops && !a.isOperator(c.MustGet("account").(identity.Account).ID) {
			respondError(c, 403, "operator_required")
			return false
		}
		return true
	}
	target := func(c *gin.Context, name string) (uuid.UUID, bool) {
		id, e := uuid.Parse(c.Param(name))
		if e != nil || id == uuid.Nil {
			publicationError(c, publication.ErrNotFound)
			return id, false
		}
		return id, true
	}
	for _, ops := range []bool{false, true} {
		ops := ops
		root := "/my/work-submissions"
		if ops {
			root = "/ops/work-submissions"
		}
		g.GET(root, func(c *gin.Context) {
			if !gate(c, ops) {
				return
			}
			owner := c.MustGet("account").(identity.Account).ID
			if ops {
				owner = uuid.Nil
			}
			work := uuid.Nil
			if raw := c.Query("work"); raw != "" {
				var e error
				work, e = uuid.Parse(raw)
				if e != nil || work == uuid.Nil {
					publicationError(c, publication.ErrInvalid)
					return
				}
			}
			out, e := s.WorkSubmissions(c.Request.Context(), owner, work, c.Query("cursor"))
			if e != nil {
				publicationError(c, e)
				return
			}
			c.JSON(200, out)
		})
		g.GET(root+"/:submission", func(c *gin.Context) {
			if !gate(c, ops) {
				return
			}
			id, ok := target(c, "submission")
			if !ok {
				return
			}
			owner := c.MustGet("account").(identity.Account).ID
			if ops {
				owner = uuid.Nil
			}
			out, e := s.WorkSubmissionDetail(c.Request.Context(), owner, id)
			if e != nil {
				publicationError(c, e)
				return
			}
			c.JSON(200, out)
		})
		action := "/withdraw"
		if ops {
			action = "/review"
		}
		g.POST(root+"/:submission"+action, func(c *gin.Context) {
			if !gate(c, ops) {
				return
			}
			id, ok := target(c, "submission")
			if !ok {
				return
			}
			var in publication.WorkSubmissionDecision
			if ops {
				if c.ShouldBindJSON(&in) != nil {
					publicationError(c, publication.ErrInvalid)
					return
				}
			} else {
				var w struct {
					MutationID uuid.UUID `json:"mutation_id"`
				}
				if c.ShouldBindJSON(&w) != nil {
					publicationError(c, publication.ErrInvalid)
					return
				}
				in.MutationID = w.MutationID
				in.Decision = "withdraw"
			}
			out, e := s.DecideWorkSubmission(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id, !ops, in)
			if e != nil {
				publicationError(c, e)
				return
			}
			c.JSON(200, out)
		})
	}
	g.GET("/work-submission-requests/:mutation", func(c *gin.Context) {
		if !gate(c, false) {
			return
		}
		id, ok := target(c, "mutation")
		if !ok {
			return
		}
		out, e := s.WorkSubmissionReceipt(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
}
