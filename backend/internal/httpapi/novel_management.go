package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strconv"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func (a API) registerNovelManagement(protected *gin.RouterGroup) {
	s := novel.Store{DB: a.DB}
	enabled := func(c *gin.Context, operator bool) bool {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return false
		}
		if operator && !a.isOperator(c.MustGet("account").(identity.Account).ID) {
			respondError(c, 403, "operator_required")
			return false
		}
		return true
	}
	target := func(c *gin.Context, name string) (uuid.UUID, bool) {
		id, e := uuid.Parse(c.Param(name))
		if e != nil || id == uuid.Nil {
			novelError(c, novel.ErrNotFound)
			return uuid.Nil, false
		}
		return id, true
	}
	scope := func(c *gin.Context, operator bool) (uuid.UUID, uuid.UUID, bool) {
		if !enabled(c, operator) {
			return uuid.Nil, uuid.Nil, false
		}
		book, ok := target(c, "id")
		return c.MustGet("account").(identity.Account).ID, book, ok
	}
	send := func(c *gin.Context, out any, e error) {
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, out)
	}
	root := "/my/novels/:id"
	protected.GET(root+"/publication-chapters", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		out, e := s.ManagedChapters(c.Request.Context(), owner, book, c.Query("cursor"))
		send(c, out, e)
	})
	protected.GET(root+"/formal-state", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		out, e := s.NovelState(c.Request.Context(), owner, book)
		send(c, out, e)
	})
	protected.GET(root+"/chapters/:chapter/state", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		chapter, ok := target(c, "chapter")
		if !ok {
			return
		}
		out, e := s.ChapterState(c.Request.Context(), owner, book, chapter)
		send(c, out, e)
	})
	for _, chapterMode := range []bool{false, true} {
		chapterMode := chapterMode
		path := root + "/visibility"
		if chapterMode {
			path = root + "/chapters/:chapter/visibility"
		}
		protected.POST(path, func(c *gin.Context) {
			owner, book, ok := scope(c, false)
			if !ok {
				return
			}
			chapter := uuid.Nil
			if chapterMode {
				chapter, ok = target(c, "chapter")
				if !ok {
					return
				}
			}
			var in novel.VisibilityAction
			if c.ShouldBindJSON(&in) != nil {
				novelError(c, novel.ErrInvalid)
				return
			}
			out, e := s.ChangeVisibility(c.Request.Context(), owner, book, chapter, in)
			send(c, out, e)
		})
	}
	protected.GET(root+"/visibility-requests/:mutation", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "mutation")
		if !ok {
			return
		}
		out, e := s.VisibilityReceipt(c.Request.Context(), owner, book, id)
		send(c, out, e)
	})
	protected.GET(root+"/chapters/:chapter/versions", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		chapter, ok := target(c, "chapter")
		if !ok {
			return
		}
		before, e := strconv.ParseUint(c.DefaultQuery("before", "0"), 10, 64)
		if e != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.ChapterVersions(c.Request.Context(), owner, book, chapter, before)
		send(c, out, e)
	})
	protected.GET(root+"/chapters/:chapter/versions/:version", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		chapter, ok := target(c, "chapter")
		if !ok {
			return
		}
		version, e := strconv.ParseUint(c.Param("version"), 10, 64)
		if e != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.ChapterVersion(c.Request.Context(), owner, book, chapter, version)
		send(c, out, e)
	})
	protected.POST(root+"/metadata-submissions", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		var in novel.SubmitMetadata
		if c.ShouldBindJSON(&in) != nil {
			novelError(c, novel.ErrInvalid)
			return
		}
		out, e := s.SubmitMetadata(c.Request.Context(), owner, book, in)
		send(c, out, e)
	})
	protected.GET(root+"/metadata-submissions", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		out, e := s.MetadataSubmissions(c.Request.Context(), owner, book, c.Query("cursor"))
		send(c, out, e)
	})
	protected.GET(root+"/metadata-submissions/:submission", func(c *gin.Context) {
		owner, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "submission")
		if !ok {
			return
		}
		out, e := s.MetadataSubmission(c.Request.Context(), owner, book, id)
		send(c, out, e)
	})
	protected.POST(root+"/metadata-submissions/:submission/withdraw", func(c *gin.Context) {
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
		out, e := s.WithdrawMetadata(c.Request.Context(), owner, book, id, in)
		send(c, out, e)
	})
	protected.GET(root+"/metadata-requests/:mutation", func(c *gin.Context) {
		actor, book, ok := scope(c, false)
		if !ok {
			return
		}
		id, ok := target(c, "mutation")
		if !ok {
			return
		}
		out, e := s.MetadataReceipt(c.Request.Context(), actor, book, id)
		send(c, out, e)
	})
	protected.GET("/ops/novels/metadata-review-queue", func(c *gin.Context) {
		if !enabled(c, true) {
			return
		}
		out, e := s.MetadataReviewQueue(c.Request.Context(), c.Query("cursor"), c.Query("mode"))
		send(c, out, e)
	})
	ops := "/ops/novels/:id/metadata-submissions/:submission"
	protected.GET(ops, func(c *gin.Context) {
		_, book, ok := scope(c, true)
		if !ok {
			return
		}
		id, ok := target(c, "submission")
		if !ok {
			return
		}
		out, e := s.OperatorMetadataSubmission(c.Request.Context(), book, id)
		send(c, out, e)
	})
	protected.POST(ops+"/review", func(c *gin.Context) {
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
		out, e := s.DecideMetadata(c.Request.Context(), actor, book, id, in)
		send(c, out, e)
	})
}
