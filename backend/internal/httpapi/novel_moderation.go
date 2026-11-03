package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strconv"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func (a API) registerNovelModeration(protected *gin.RouterGroup) {
	s := novel.Store{DB: a.DB}
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
	scope := func(c *gin.Context, ops bool) (uuid.UUID, uuid.UUID, bool) {
		if !gate(c, ops) {
			return uuid.Nil, uuid.Nil, false
		}
		book, e := uuid.Parse(c.Param("id"))
		if e != nil || book == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return uuid.Nil, uuid.Nil, false
		}
		return c.MustGet("account").(identity.Account).ID, book, true
	}
	target := func(c *gin.Context, name string) (uuid.UUID, bool) {
		id, e := uuid.Parse(c.Param(name))
		if e != nil || id == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return uuid.Nil, false
		}
		return id, true
	}
	number := func(c *gin.Context, name string, path bool) (uint64, bool) {
		raw := c.DefaultQuery(name, "0")
		if path {
			raw = c.Param(name)
		}
		n, e := strconv.ParseUint(raw, 10, 64)
		if e != nil || n > 9007199254740991 || (path && n == 0) {
			novelError(c, novel.ErrInvalid)
			return 0, false
		}
		return n, true
	}
	send := func(c *gin.Context, out any, e error) {
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	}
	protected.POST("/ops/novels/:id/limits", func(c *gin.Context) {
		actor, book, ok := scope(c, true)
		if !ok {
			return
		}
		var in novel.LimitNovel
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.LimitNovel(c.Request.Context(), actor, book, in)
		send(c, out, e)
	})
	protected.GET("/ops/novels/moderation", func(c *gin.Context) {
		if !gate(c, true) {
			return
		}
		before, ok := number(c, "before", false)
		if !ok {
			return
		}
		out, e := s.NovelCases(c.Request.Context(), uuid.Nil, uuid.Nil, before, c.DefaultQuery("state", "active"))
		send(c, out, e)
	})
	protected.GET("/my/novels/:id/moderation", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		before, ok := number(c, "before", false)
		if !ok {
			return
		}
		out, e := s.NovelCases(c.Request.Context(), owner, book, before, "all")
		send(c, out, e)
	})
	for _, ops := range []bool{false, true} {
		ops := ops
		root := "/my/novels/:id/moderation/:case"
		if ops {
			root = "/ops/novels/:id/moderation/:case"
		}
		protected.GET(root, func(c *gin.Context) {
			owner, book, ok := scope(c, ops)
			if !ok {
				return
			}
			id, ok := number(c, "case", true)
			if !ok {
				return
			}
			before, ok := number(c, "before_appeal", false)
			if !ok {
				return
			}
			if ops {
				owner = uuid.Nil
			}
			out, e := s.NovelCaseDetail(c.Request.Context(), owner, book, id, before)
			send(c, out, e)
		})
		protected.POST(root, func(c *gin.Context) {
			actor, book, ok := scope(c, ops)
			if !ok {
				return
			}
			id, ok := number(c, "case", true)
			if !ok {
				return
			}
			if ops {
				var in novel.NovelCaseAction
				if c.ShouldBindJSON(&in) != nil {
					novelError(c, novel.ErrInvalid)
					return
				}
				out, e := s.DecideNovelCase(c.Request.Context(), actor, book, id, in)
				send(c, out, e)
				return
			}
			var in struct {
				MutationID       uuid.UUID `json:"mutation_id"`
				ExpectedRevision uint64    `json:"expected_revision"`
				Reason           string    `json:"reason"`
			}
			if c.ShouldBindJSON(&in) != nil {
				novelError(c, novel.ErrInvalid)
				return
			}
			out, e := s.AppealNovelCase(c.Request.Context(), actor, book, id, novel.NovelCaseAction{MutationID: in.MutationID, ExpectedRevision: in.ExpectedRevision, Reason: in.Reason})
			send(c, out, e)
		})
	}
	protected.GET("/my/novels/:id/moderation-requests/:mutation", func(c *gin.Context) {
		actor, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "mutation")
		if !ok {
			return
		}
		out, e := s.NovelCaseReceipt(c.Request.Context(), actor, book, id)
		send(c, out, e)
	})
	protected.GET("/ops/novels/appeals", func(c *gin.Context) {
		if !gate(c, true) {
			return
		}
		after, ok := number(c, "after", false)
		if !ok {
			return
		}
		out, e := s.NovelPendingAppeals(c.Request.Context(), after)
		send(c, out, e)
	})
	protected.GET("/ops/novels/:id/formal-state", func(c *gin.Context) {
		_, book, ok := scope(c, true)
		if !ok {
			return
		}
		out, e := s.OperatorNovelState(c.Request.Context(), book)
		send(c, out, e)
	})
	protected.GET("/ops/novels/:id/chapters/:chapter/state", func(c *gin.Context) {
		_, book, ok := scope(c, true)
		if !ok {
			return
		}
		chapter, ok := target(c, "chapter")
		if !ok {
			return
		}
		out, e := s.OperatorChapterState(c.Request.Context(), book, chapter)
		send(c, out, e)
	})
	protected.GET("/ops/novels/:id/chapters/:chapter/versions/:version", func(c *gin.Context) {
		_, book, ok := scope(c, true)
		if !ok {
			return
		}
		chapter, ok := target(c, "chapter")
		if !ok {
			return
		}
		version, ok := number(c, "version", true)
		if !ok {
			return
		}
		out, e := s.OperatorChapterVersion(c.Request.Context(), book, chapter, version)
		send(c, out, e)
	})
	protected.GET("/ops/novels/post-reviews", func(c *gin.Context) {
		if !gate(c, true) {
			return
		}
		out, e := s.NovelPostReviews(c.Request.Context(), c.Query("cursor"))
		send(c, out, e)
	})
	protected.POST("/ops/novels/:id/post-reviews/:submission", func(c *gin.Context) {
		actor, book, ok := scope(c, true)
		if !ok {
			return
		}
		id, ok := target(c, "submission")
		if !ok {
			return
		}
		var in novel.WithdrawChapter
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.ApproveNovelPostReview(c.Request.Context(), actor, book, id, in)
		send(c, out, e)
	})
	protected.GET("/ops/novels/:id/post-review-requests/:mutation", func(c *gin.Context) {
		actor, book, ok := scope(c, true)
		if !ok {
			return
		}
		id, ok := target(c, "mutation")
		if !ok {
			return
		}
		out, e := s.NovelPostReviewReceipt(c.Request.Context(), actor, book, id)
		send(c, out, e)
	})
}
