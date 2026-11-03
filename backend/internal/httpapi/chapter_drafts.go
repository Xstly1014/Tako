package httpapi

import (
	"database/sql"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

// Stable private identity only; IDs are never an authorization credential.
func privateChapterID(book, owner, mutation uuid.UUID, operation string) uuid.UUID {
	return uuid.NewSHA1(book, []byte(owner.String()+"/"+operation+"/"+mutation.String()))
}
func (a API) registerChapterDrafts(protected *gin.RouterGroup) {
	scoped := func(c *gin.Context) (draft.Store, bool) {
		book, e := uuid.Parse(c.Param("id"))
		if e != nil || book == uuid.Nil {
			fail(c, draft.ErrNotFound)
			return draft.Store{}, false
		}
		return draft.Store{DB: a.DB, Chapter: &draft.ChapterScope{NovelID: book}}, true
	}
	protected.GET("/my/novels/:id/chapters", func(c *gin.Context) {
		book, err := uuid.Parse(c.Param("id"))
		if err != nil {
			novelError(c, novel.ErrNotFound)
			return
		}
		page, e := (novel.Store{DB: a.DB}).Chapters(c.Request.Context(), c.MustGet("account").(identity.Account).ID, book, c.Query("cursor"))
		if e != nil {
			novelError(c, e)
			return
		}
		c.JSON(200, page)
	})
	root := "/my/novels/:id/chapter-drafts"
	protected.GET(root, func(c *gin.Context) {
		s, ok := scoped(c)
		if !ok {
			return
		}
		page, err := s.List(c.Request.Context(), c.MustGet("account").(identity.Account).ID, 20, c.Query("cursor"))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, page)
	})
	protected.GET(root+"/:draft", func(c *gin.Context) {
		s, ok := scoped(c)
		if !ok {
			return
		}
		id, e := uuid.Parse(c.Param("draft"))
		if e != nil {
			fail(c, draft.ErrNotFound)
			return
		}
		out, err := s.Read(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, out)
	})
	for _, op := range []string{"create", "save", "recover"} {
		operation := op
		protected.POST(root+"/"+operation, func(c *gin.Context) {
			s, ok := scoped(c)
			if !ok {
				return
			}
			account := c.MustGet("account").(identity.Account)
			if account.Nickname == "" {
				respondError(c, 409, "nickname_required")
				return
			}
			var in draft.Write
			if c.ShouldBindJSON(&in) != nil {
				fail(c, draft.ErrInvalid)
				return
			}
			if operation == "save" {
				var chapter []byte
				err := a.DB.QueryRowContext(c.Request.Context(), "SELECT chapter_id FROM chapter_drafts WHERE id=? AND owner_id=? AND novel_id=?", in.DraftID[:], account.ID[:], s.Chapter.NovelID[:]).Scan(&chapter)
				if errors.Is(err, sql.ErrNoRows) {
					fail(c, draft.ErrNotFound)
					return
				}
				if err != nil {
					fail(c, err)
					return
				}
				id, err := uuid.FromBytes(chapter)
				if err != nil {
					fail(c, err)
					return
				}
				s.Chapter.ChapterID = id
			} else {
				s.Chapter.ChapterID = privateChapterID(s.Chapter.NovelID, account.ID, in.MutationID, operation)
			}
			out, err := s.Write(c.Request.Context(), account.ID, operation, in)
			if err != nil {
				fail(c, err)
				return
			}
			c.JSON(200, out)
		})
	}
}
