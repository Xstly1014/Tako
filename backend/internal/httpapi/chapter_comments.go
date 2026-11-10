package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"strconv"
	"strings"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func novelCommentError(c *gin.Context, e error) {
	switch {
	case errors.Is(e, novel.ErrCommentConflict):
		respondError(c, 409, "comment_conflict")
	case errors.Is(e, novel.ErrCommentLimited):
		c.Header("Retry-After", "60")
		respondError(c, 429, "rate_limited")
	case errors.Is(e, novel.ErrCommentVersionUnavailable):
		respondError(c, 409, "version_unavailable")
	default:
		novelError(c, e)
	}
}
func (a API) signChapterCommentContext(book, chapter uuid.UUID, version uint64) string {
	if a.Identity == nil || len(a.Identity.Pepper) < 32 {
		return ""
	}
	payload := fmt.Sprintf("%s:%s:%d", book, chapter, version)
	mac := hmac.New(sha256.New, a.Identity.Pepper)
	mac.Write([]byte("tako-chapter-comment-context/v1:" + a.Origin + ":" + payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (a API) parseChapterCommentContext(book, chapter uuid.UUID, token string) (uint64, bool) {
	if len(token) > 512 {
		return 0, false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return 0, false
	}
	raw, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return 0, false
	}
	fields := strings.Split(string(raw), ":")
	if len(fields) != 3 || fields[0] != book.String() || fields[1] != chapter.String() {
		return 0, false
	}
	v, e := strconv.ParseUint(fields[2], 10, 64)
	if e != nil || v == 0 || v > 9007199254740991 {
		return 0, false
	}
	expected := a.signChapterCommentContext(book, chapter, v)
	return v, expected != "" && hmac.Equal([]byte(token), []byte(expected))
}
func (a API) registerChapterComments(api, protected *gin.RouterGroup) {
	store := novel.Store{DB: a.DB}
	gate := func(c *gin.Context) bool {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return false
		}
		return true
	}
	idOf := func(c *gin.Context) (uuid.UUID, bool) {
		id, e := uuid.Parse(c.Param("id"))
		if e != nil || id == uuid.Nil {
			novelCommentError(c, novel.ErrNotFound)
			return id, false
		}
		return id, true
	}
	cursor := func(c *gin.Context) (uint64, bool) {
		raw := c.DefaultQuery("cursor", "0")
		v, e := strconv.ParseUint(raw, 10, 64)
		if e != nil || v > 9007199254740991 {
			novelCommentError(c, novel.ErrInvalid)
			return 0, false
		}
		return v, true
	}
	reply := func(c *gin.Context, out any, e error) {
		if e != nil {
			novelCommentError(c, e)
			return
		}
		c.JSON(200, out)
	}
	api.GET("/novels/:id/chapters/:chapter/comments", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		work, ok := idOf(c)
		if !ok {
			return
		}
		chapter, e := uuid.Parse(c.Param("chapter"))
		if e != nil || chapter == uuid.Nil {
			novelCommentError(c, novel.ErrNotFound)
			return
		}
		n, ok := cursor(c)
		if !ok {
			return
		}
		root := uuid.Nil
		if raw := c.Query("root"); raw != "" {
			var e error
			root, e = uuid.Parse(raw)
			if e != nil || root == uuid.Nil {
				novelCommentError(c, novel.ErrInvalid)
				return
			}
		}
		viewer := uuid.Nil
		if cookie, _ := c.Cookie(a.sessionCookieName()); cookie != "" || c.GetHeader("Authorization") != "" {
			account, e := a.authenticate(c)
			if e == nil {
				viewer = account.ID
			} else if !errors.Is(e, identity.ErrInvalid) {
				respondError(c, 503, "service_unavailable")
				return
			}
		}
		out, e := store.ChapterComments(c.Request.Context(), work, chapter, root, viewer, n)
		reply(c, out, e)
	})
	protected.POST("/novels/:id/chapters/:chapter/comments", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		work, ok := idOf(c)
		if !ok {
			return
		}
		chapter, e := uuid.Parse(c.Param("chapter"))
		if e != nil || chapter == uuid.Nil {
			novelCommentError(c, novel.ErrNotFound)
			return
		}
		var in novel.ChapterCommentCreate
		if c.ShouldBindJSON(&in) != nil {
			novelCommentError(c, novel.ErrInvalid)
			return
		}
		version, ok := a.parseChapterCommentContext(work, chapter, in.Context)
		if !ok {
			respondError(c, 409, "reading_context_invalid")
			return
		}
		out, e := store.CreateChapterComment(c.Request.Context(), c.MustGet("account").(identity.Account).ID, work, chapter, version, in)
		reply(c, out, e)
	})
	protected.POST("/chapter-comments/:id/actions", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		id, ok := idOf(c)
		if !ok {
			return
		}
		var in novel.ChapterCommentAction
		if c.ShouldBindJSON(&in) != nil || in.Action != "delete" {
			novelCommentError(c, novel.ErrInvalid)
			return
		}
		out, e := store.ActOnChapterComment(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id, false, in)
		reply(c, out, e)
	})
	protected.GET("/my/chapter-comments", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		n, ok := cursor(c)
		if !ok {
			return
		}
		out, e := store.ManagedChapterComments(c.Request.Context(), c.MustGet("account").(identity.Account).ID, false, n)
		reply(c, out, e)
	})
	protected.GET("/my/novels/:id/chapter-comments", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		book, ok := idOf(c)
		if !ok {
			return
		}
		n, ok := cursor(c)
		if !ok {
			return
		}
		out, e := store.ChapterCommentsForAuthor(c.Request.Context(), c.MustGet("account").(identity.Account).ID, book, n)
		reply(c, out, e)
	})
	ops := func(c *gin.Context) bool {
		if !gate(c) {
			return false
		}
		if !a.isOperator(c.MustGet("account").(identity.Account).ID) {
			respondError(c, 403, "operator_required")
			return false
		}
		return true
	}
	protected.GET("/ops/chapter-comments", func(c *gin.Context) {
		if !ops(c) {
			return
		}
		n, ok := cursor(c)
		if !ok {
			return
		}
		out, e := store.ManagedChapterComments(c.Request.Context(), c.MustGet("account").(identity.Account).ID, true, n)
		reply(c, out, e)
	})
	protected.POST("/ops/chapter-comments/:id/actions", func(c *gin.Context) {
		if !ops(c) {
			return
		}
		id, ok := idOf(c)
		if !ok {
			return
		}
		var in novel.ChapterCommentAction
		if c.ShouldBindJSON(&in) != nil || (in.Action != "block" && in.Action != "unblock") {
			novelCommentError(c, novel.ErrInvalid)
			return
		}
		out, e := store.ActOnChapterComment(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id, true, in)
		reply(c, out, e)
	})
}
