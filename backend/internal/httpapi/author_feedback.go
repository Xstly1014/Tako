package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strconv"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func (a API) registerAuthorFeedback(protected *gin.RouterGroup) {
	store := publication.Store{DB: a.DB}
	gate := func(c *gin.Context) bool {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return false
		}
		return true
	}
	protected.GET("/my/work-feedback", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		status := c.DefaultQuery("status", "all")
		cursor, err := strconv.ParseUint(c.DefaultQuery("cursor", "0"), 10, 64)
		if err != nil || cursor > publication.MaxSequence || (status != "all" && status != "awaiting_author") {
			publicationError(c, publication.ErrInvalid)
			return
		}
		out, err := store.AuthorFeedback(c.Request.Context(), c.MustGet("account").(identity.Account).ID, status == "awaiting_author", cursor)
		if err != nil {
			publicationError(c, err)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/work-feedback/:id", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		id, err := uuid.Parse(c.Param("id"))
		if err != nil || id == uuid.Nil {
			publicationError(c, publication.ErrNotFound)
			return
		}
		out, err := store.AuthorFeedbackThread(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id)
		if err != nil {
			publicationError(c, err)
			return
		}
		c.JSON(200, out)
	})
}
