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
	operatorOnly := func(c *gin.Context) {
		if !a.isOperator(c.MustGet("account").(identity.Account).ID) {
			respondError(c, 403, "operator_required")
			return
		}
		c.Next()
	}
	ops := protected.Group("/ops/short-posts", a.shortPostTestOnly, operatorOnly)
	a.registerShortPostAppeals(protected, author, ops, operatorOnly, store)
	author.GET("", func(c *gin.Context) {
		owner := c.MustGet("account").(identity.Account).ID
		out, err := store.OwnedPosts(c.Request.Context(), owner, c.Query("cursor"))
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	ops.GET("", func(c *gin.Context) {
		out, err := store.Queue(c.Request.Context(), c.Query("cursor"))
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	author.GET("/:id/versions", func(c *gin.Context) {
		id, ok := shortPostTarget(c, "id")
		if !ok {
			return
		}
		var before uint64
		if raw := c.Query("before"); raw != "" {
			before, ok = shortPostVersion(raw)
			if !ok {
				respondError(c, 400, "invalid_input")
				return
			}
		}
		owner := c.MustGet("account").(identity.Account).ID
		out, err := store.OwnerVersions(c.Request.Context(), owner, id, before)
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	author.GET("/:id/versions/:version", func(c *gin.Context) {
		id, ok := shortPostTarget(c, "id")
		if !ok {
			return
		}
		version, ok := shortPostVersion(c.Param("version"))
		if !ok {
			respondError(c, 404, "resource_not_found")
			return
		}
		owner := c.MustGet("account").(identity.Account).ID
		out, err := store.OwnerVersion(c.Request.Context(), id, owner, version)
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	author.PUT("/:id/revisions/:revisionId", func(c *gin.Context) {
		id, ok := shortPostTarget(c, "id")
		if !ok {
			return
		}
		revision, ok := shortPostTarget(c, "revisionId")
		if !ok {
			return
		}
		var in shortpost.RevisePost
		if c.ShouldBindJSON(&in) != nil {
			respondError(c, 400, "invalid_input")
			return
		}
		owner := c.MustGet("account").(identity.Account)
		if owner.Nickname == "" {
			respondError(c, 409, "nickname_required")
			return
		}
		out, err := store.Revise(c.Request.Context(), owner.ID, id, revision, in)
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	for _, group := range []*gin.RouterGroup{author, ops} {
		operator := group == ops
		group.GET("/:id/revisions/:revisionId", func(c *gin.Context) {
			id, ok := shortPostTarget(c, "id")
			if !ok {
				return
			}
			revision, ok := shortPostTarget(c, "revisionId")
			if !ok {
				return
			}
			owner := uuid.Nil
			if !operator {
				owner = c.MustGet("account").(identity.Account).ID
			}
			out, err := store.Revision(c.Request.Context(), owner, id, revision)
			if err != nil {
				shortPostError(c, err)
				return
			}
			c.JSON(200, out)
		})
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
	protected.GET("/ops/short-post-revisions", a.shortPostTestOnly, operatorOnly, func(c *gin.Context) {
		out, err := store.RevisionQueue(c.Request.Context(), c.Query("cursor"))
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.JSON(200, out)
	})
	ops.GET("/:id/revisions/:revisionId/images/:imageId", func(c *gin.Context) {
		id, ok := shortPostTarget(c, "id")
		if !ok {
			return
		}
		revision, ok := shortPostTarget(c, "revisionId")
		if !ok {
			return
		}
		image, ok := shortPostTarget(c, "imageId")
		if !ok {
			return
		}
		mediaType, body, err := store.RevisionReviewImage(c.Request.Context(), id, revision, image)
		if err != nil {
			shortPostError(c, err)
			return
		}
		c.Header("X-Content-Type-Options", "nosniff")
		c.Data(200, mediaType, body)
	})
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
