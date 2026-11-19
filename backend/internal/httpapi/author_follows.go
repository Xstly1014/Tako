package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func (a API) registerAuthorFollows(protected *gin.RouterGroup) {
	store := publication.Store{DB: a.DB}
	group := protected.Group("/my/author-social", func(c *gin.Context) {
		if !a.EnablePublications || a.DB == nil {
			respondError(c, 503, "publication_disabled")
			return
		}
		c.Next()
	})
	viewer := func(c *gin.Context) uuid.UUID { return c.MustGet("account").(identity.Account).ID }
	relation := func(c *gin.Context) {
		kind := c.Param("kind")
		if kind == "post" && a.EnvironmentName != "test" {
			respondError(c, 503, "publication_disabled")
			return
		}
		target, err := uuid.Parse(c.Param("id"))
		if err != nil || target == uuid.Nil {
			respondError(c, 400, "invalid_input")
			return
		}
		var change *publication.FollowChange
		if c.Request.Method == "PUT" {
			var in struct {
				Following *bool   `json:"following"`
				Expected  *uint64 `json:"expected_revision"`
			}
			if c.ShouldBindJSON(&in) != nil || in.Following == nil || in.Expected == nil || *in.Expected >= publication.MaxSequence {
				respondError(c, 400, "invalid_input")
				return
			}
			change = &publication.FollowChange{Following: *in.Following, ExpectedRevision: *in.Expected}
		}
		out, err := store.AuthorFollow(c.Request.Context(), viewer(c), kind, target, change)
		if err != nil {
			publicationError(c, err)
			return
		}
		c.JSON(200, out)
	}
	group.GET("/targets/:kind/:id", relation)
	group.PUT("/targets/:kind/:id", relation)
	for _, name := range []string{"following", "followers"} {
		group.GET("/"+name, func(c *gin.Context) {
			out, err := store.FollowPeople(c.Request.Context(), viewer(c), name, c.Query("cursor"))
			if err != nil {
				publicationError(c, err)
				return
			}
			c.JSON(200, out)
		})
	}
	group.GET("/feed", func(c *gin.Context) {
		out, err := store.FollowingFeed(c.Request.Context(), viewer(c), c.Query("cursor"), a.EnvironmentName == "test" && c.Query("include_posts") != "false")
		if err != nil {
			publicationError(c, err)
			return
		}
		c.JSON(200, out)
	})
}
