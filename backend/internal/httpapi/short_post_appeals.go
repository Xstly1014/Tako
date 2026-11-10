package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/shortpost"
)

func (a API) registerShortPostAppeals(protected, author, ops *gin.RouterGroup, operatorOnly gin.HandlerFunc, store shortpost.PostStore) {
	protected.GET("/ops/short-post-appeals", a.shortPostTestOnly, operatorOnly, func(c *gin.Context) {
		before, ok := shortAppealBefore(c)
		if !ok {
			return
		}
		out, err := store.Appeals(c.Request.Context(), uuid.Nil, uuid.Nil, before)
		sendShortAppeal(c, out, err)
	})
	author.GET("/:id/appeals", func(c *gin.Context) {
		post, ok := shortPostTarget(c, "id")
		if !ok {
			return
		}
		before, ok := shortAppealBefore(c)
		if !ok {
			return
		}
		owner := c.MustGet("account").(identity.Account).ID
		out, err := store.Appeals(c.Request.Context(), owner, post, before)
		sendShortAppeal(c, out, err)
	})
	author.PUT("/:id/appeals/:appealId", func(c *gin.Context) {
		post, ok := shortPostTarget(c, "id")
		if !ok {
			return
		}
		id, ok := shortPostTarget(c, "appealId")
		if !ok {
			return
		}
		var in shortpost.FileAppeal
		if c.ShouldBindJSON(&in) != nil {
			respondError(c, 400, "invalid_input")
			return
		}
		owner := c.MustGet("account").(identity.Account).ID
		out, err := store.FileAppeal(c.Request.Context(), owner, post, id, in)
		sendShortAppeal(c, out, err)
	})
	for _, group := range []*gin.RouterGroup{author, ops} {
		operator := group == ops
		group.GET("/:id/appeals/:appealId", func(c *gin.Context) {
			post, ok := shortPostTarget(c, "id")
			if !ok {
				return
			}
			id, ok := shortPostTarget(c, "appealId")
			if !ok {
				return
			}
			owner := uuid.Nil
			if !operator {
				owner = c.MustGet("account").(identity.Account).ID
			}
			out, err := store.ReadAppeal(c.Request.Context(), owner, post, id)
			sendShortAppeal(c, out, err)
		})
	}
}

func shortAppealBefore(c *gin.Context) (uint64, bool) {
	raw := c.Query("before")
	if raw == "" {
		return 0, true
	}
	value, ok := shortPostVersion(raw)
	if !ok {
		respondError(c, 400, "invalid_input")
	}
	return value, ok
}

func sendShortAppeal(c *gin.Context, out any, err error) {
	if err != nil {
		shortPostError(c, err)
		return
	}
	c.JSON(200, out)
}
