package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func (a API) registerChapterPublication(protected *gin.RouterGroup) {
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
	target := func(c *gin.Context, name string) (uuid.UUID, bool) {
		id, e := uuid.Parse(c.Param(name))
		if e != nil || id == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return uuid.Nil, false
		}
		return id, true
	}
	protected.GET("/my/novels/:id/chapters/:chapter/submissions", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		chapter, ok := target(c, "chapter")
		if !ok {
			return
		}
		out, e := s.ChapterSubmissionsFor(c.Request.Context(), owner, book, chapter, c.Query("cursor"))
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/novels/:id/chapter-submissions", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		out, e := s.ChapterSubmissions(c.Request.Context(), owner, book, c.Query("cursor"))
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/novels/:id/chapter-submissions/:submission", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "submission")
		if !ok {
			return
		}
		out, e := s.ChapterSubmission(c.Request.Context(), owner, book, id)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/ops/novels/chapter-review-queue", func(c *gin.Context) {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return
		}
		if !a.isOperator(c.MustGet("account").(identity.Account).ID) {
			respondError(c, 403, "operator_required")
			return
		}
		out, e := s.ChapterReviewQueue(c.Request.Context(), c.Query("cursor"))
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/ops/novels/:id/chapter-submissions/:submission", func(c *gin.Context) {
		_, book, ok := scope(c, true)
		if !ok {
			return
		}
		id, ok := target(c, "submission")
		if !ok {
			return
		}
		out, e := s.OperatorChapterSubmission(c.Request.Context(), book, id)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.POST("/my/novels/:id/chapter-previews", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		var in novel.PrepareChapter
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.PrepareChapter(c.Request.Context(), owner, book, in)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/novels/:id/chapter-previews/:preview", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "preview")
		if !ok {
			return
		}
		out, e := s.ChapterPreview(c.Request.Context(), owner, book, id)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.POST("/my/novels/:id/chapter-submissions", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		var in novel.SubmitChapter
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.SubmitChapter(c.Request.Context(), owner, book, in)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/novels/:id/publication-requests/:mutation", func(c *gin.Context) {
		actor, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "mutation")
		if !ok {
			return
		}
		out, e := s.ChapterPublicationReceipt(c.Request.Context(), actor, book, id)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.POST("/my/novels/:id/chapter-submissions/:submission/withdraw", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
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
		out, e := s.WithdrawChapter(c.Request.Context(), owner, book, id, in)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.POST("/ops/novels/:id/chapter-submissions/:submission/review", func(c *gin.Context) {
		actor, book, ok := scope(c, true)
		if !ok {
			return
		}
		id, ok := target(c, "submission")
		if !ok {
			return
		}
		var in novel.DecideChapter
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.DecideChapter(c.Request.Context(), actor, book, id, in)
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	})
}
