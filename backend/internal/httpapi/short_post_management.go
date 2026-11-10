package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/shortpost"
)

func (a API) registerShortPostManagement(protected *gin.RouterGroup) {
	store := shortpost.PostStore{DB: a.DB}
	author := protected.Group("/my/short-posts", a.shortPostTestOnly)
	ops := protected.Group("/ops/short-posts", a.shortPostTestOnly, func(c *gin.Context) {
		if !a.isOperator(c.MustGet("account").(identity.Account).ID) {
			respondError(c, 403, "operator_required")
			return
		}
		c.Next()
	})
	ops.GET("", func(c *gin.Context) {
		out, err := store.Queue(c.Request.Context(), c.Query("cursor"))
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	for _, group := range []*gin.RouterGroup{author, ops} {
		operator := group == ops
		group.GET("/:id", func(c *gin.Context) {
			id, ok := shortPostTarget(c, "id")
			if !ok {
				return
			}
			owner := uuid.Nil
			if !operator {
				owner = c.MustGet("account").(identity.Account).ID
			}
			out, err := store.Manage(c.Request.Context(), id, owner)
			if err != nil {
				shortPostError(c, err)
				return
			}
			c.JSON(200, out)
		})
		group.POST("/:id/actions", func(c *gin.Context) {
			id, ok := shortPostTarget(c, "id")
			if !ok {
				return
			}
			var in shortpost.PostAction
			if c.ShouldBindJSON(&in) != nil {
				respondError(c, 400, "invalid_input")
				return
			}
			actor := c.MustGet("account").(identity.Account).ID
			out, err := store.ChangeState(c.Request.Context(), actor, id, operator, in)
			if err != nil {
				shortPostError(c, err)
				return
			}
			c.JSON(200, out)
		})
	}
	ops.GET("/:id/images/:imageId", func(c *gin.Context) {
		id, ok := shortPostTarget(c, "id")
		if !ok {
			return
		}
		image, ok := shortPostTarget(c, "imageId")
		if !ok {
			return
		}
		mediaType, body, err := store.ReviewImage(c.Request.Context(), id, image)
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(200, mediaType, body)
	})
}

func shortPostTarget(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil || id == uuid.Nil {
		respondError(c, 404, "resource_not_found")
		return uuid.Nil, false
	}
	return id, true
}
