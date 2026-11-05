package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strconv"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func (a API) registerNovelLifecycle(protected *gin.RouterGroup) {
	s := novel.Store{DB: a.DB}
	scope := func(c *gin.Context, operator bool) (uuid.UUID, uuid.UUID, bool) {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return uuid.Nil, uuid.Nil, false
		}
		actor := c.MustGet("account").(identity.Account).ID
		if operator && !a.isOperator(actor) {
			respondError(c, 403, "operator_required")
			return uuid.Nil, uuid.Nil, false
		}
		book, e := uuid.Parse(c.Param("id"))
		if e != nil || book == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return uuid.Nil, uuid.Nil, false
		}
		return actor, book, true
	}
	target := func(c *gin.Context, key string) (uuid.UUID, bool) {
		id, e := uuid.Parse(c.Param(key))
		if e != nil || id == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return uuid.Nil, false
		}
		return id, true
	}
	send := func(c *gin.Context, out any, e error) {
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	}
	root := "/my/novels/:id"
	protected.GET("/ops/novels/:id/chapters", func(c *gin.Context) {
		_, book, ok := scope(c, true)
		if !ok {
			return
		}
		after, e := strconv.ParseUint(c.DefaultQuery("after", "0"), 10, 64)
		if e != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.OperatorChapters(c.Request.Context(), book, after)
		send(c, out, e)
	})
	protected.POST(root+"/completion-checks", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		var in novel.PrepareCompletion
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.PrepareCompletion(c.Request.Context(), owner, book, in)
		send(c, out, e)
	})
	protected.GET(root+"/completion-checks/:check", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "check")
		if !ok {
			return
		}
		out, e := s.CompletionCheck(c.Request.Context(), owner, book, id)
		send(c, out, e)
	})
	protected.POST(root+"/completion", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		var in novel.ConfirmCompletion
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.ConfirmCompletion(c.Request.Context(), owner, book, in)
		send(c, out, e)
	})
	protected.GET(root+"/rectification-previews/:preview", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "preview")
		if !ok {
			return
		}
		out, e := s.RectificationPreview(c.Request.Context(), owner, book, id)
		send(c, out, e)
	})
	protected.POST(root+"/rectifications/:grant/previews", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "grant")
		if !ok {
			return
		}
		var in novel.PrepareRectification
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.PrepareRectification(c.Request.Context(), owner, book, id, in)
		send(c, out, e)
	})
	protected.POST(root+"/rectifications/:grant/submission", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "grant")
		if !ok {
			return
		}
		var in novel.SubmitRectification
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.SubmitRectification(c.Request.Context(), owner, book, id, in)
		send(c, out, e)
	})
	protected.POST(root+"/rectifications/:grant/withdraw", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "grant")
		if !ok {
			return
		}
		var in novel.RectificationAction
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.ResolveRectification(c.Request.Context(), owner, book, id, "withdraw", in)
		send(c, out, e)
	})
	for _, operator := range []bool{false, true} {
		operator := operator
		prefix := root
		if operator {
			prefix = "/ops/novels/:id"
		}
		protected.GET(prefix+"/lifecycle-requests/:mutation", func(c *gin.Context) {
			actor, book, ok := scope(c, operator)
			if !ok {
				return
			}
			id, ok := target(c, "mutation")
			if !ok {
				return
			}
			out, e := s.LifecycleReceipt(c.Request.Context(), actor, book, id)
			send(c, out, e)
		})
		protected.GET(prefix+"/rectifications", func(c *gin.Context) {
			owner, book, ok := scope(c, operator)
			if !ok {
				return
			}
			if operator {
				owner = uuid.Nil
			}
			before, e := strconv.ParseUint(c.DefaultQuery("before", "0"), 10, 64)
			if e != nil {
				novelError(c, novel.ErrInvalid)
				return
			}
			out, e := s.Rectifications(c.Request.Context(), owner, book, before)
			send(c, out, e)
		})
		protected.GET(prefix+"/rectifications/:grant", func(c *gin.Context) {
			owner, book, ok := scope(c, operator)
			if !ok {
				return
			}
			if operator {
				owner = uuid.Nil
			}
			id, ok := target(c, "grant")
			if !ok {
				return
			}
			out, e := s.Rectification(c.Request.Context(), owner, book, id)
			send(c, out, e)
		})
	}
	protected.POST("/ops/novels/:id/rectifications", func(c *gin.Context) {
		actor, book, ok := scope(c, true)
		if !ok {
			return
		}
		var in novel.GrantRectification
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.GrantRectification(c.Request.Context(), actor, book, in)
		send(c, out, e)
	})
	protected.POST("/ops/novels/:id/rectifications/:grant/actions/:action", func(c *gin.Context) {
		actor, book, ok := scope(c, true)
		if !ok {
			return
		}
		id, ok := target(c, "grant")
		if !ok {
			return
		}
		action := c.Param("action")
		if action != "approve" && action != "reject" && action != "cancel" {
			novelError(c, novel.ErrInvalid)
			return
		}
		var in novel.RectificationAction
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.ResolveRectification(c.Request.Context(), actor, book, id, action, in)
		send(c, out, e)
	})
}
