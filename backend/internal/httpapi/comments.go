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
	"writing.local/community/internal/publication"
)

func (a API) signCommentContext(work uuid.UUID, version uint64) string {
	if a.Identity == nil || len(a.Identity.Pepper) < 32 {
		return ""
	}
	payload := fmt.Sprintf("%s:%d", work, version)
	mac := hmac.New(sha256.New, a.Identity.Pepper)
	mac.Write([]byte("tako-comment-context/v1:" + a.Origin + ":" + payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (a API) parseCommentContext(work uuid.UUID, token string) (uint64, bool) {
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
	values := strings.Split(string(raw), ":")
	if len(values) != 2 || values[0] != work.String() {
		return 0, false
	}
	version, e := strconv.ParseUint(values[1], 10, 64)
	if e != nil || version == 0 || version > publication.MaxSequence {
		return 0, false
	}
	expected := a.signCommentContext(work, version)
	return version, expected != "" && hmac.Equal([]byte(expected), []byte(token))
}
func (a API) registerComments(api, protected *gin.RouterGroup) {
	store := publication.Store{DB: a.DB}
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
			publicationError(c, publication.ErrNotFound)
			return id, false
		}
		return id, true
	}
	cursor := func(c *gin.Context) (uint64, bool) {
		raw := c.DefaultQuery("cursor", "0")
		v, e := strconv.ParseUint(raw, 10, 64)
		if e != nil || v > publication.MaxSequence {
			publicationError(c, publication.ErrInvalid)
			return 0, false
		}
		return v, true
	}
	reply := func(c *gin.Context, out any, e error) {
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	}
	api.GET("/works/:id/comments", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		work, ok := idOf(c)
		if !ok {
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
				publicationError(c, publication.ErrInvalid)
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
		out, e := store.Comments(c.Request.Context(), work, root, viewer, n)
		reply(c, out, e)
	})
	protected.POST("/works/:id/comments", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		work, ok := idOf(c)
		if !ok {
			return
		}
		var in publication.CommentCreate
		if c.ShouldBindJSON(&in) != nil {
			publicationError(c, publication.ErrInvalid)
			return
		}
		version, ok := a.parseCommentContext(work, in.Context)
		if !ok {
			respondError(c, 409, "reading_context_invalid")
			return
		}
		out, e := store.CreateComment(c.Request.Context(), c.MustGet("account").(identity.Account).ID, work, version, in)
		reply(c, out, e)
	})
	protected.POST("/comments/:id/actions", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		id, ok := idOf(c)
		if !ok {
			return
		}
		var in publication.CommentAction
		if c.ShouldBindJSON(&in) != nil || in.Action != "delete" {
			publicationError(c, publication.ErrInvalid)
			return
		}
		out, e := store.ActOnComment(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id, false, in)
		reply(c, out, e)
	})
	protected.GET("/my/comments", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		n, ok := cursor(c)
		if !ok {
			return
		}
		out, e := store.ManagedComments(c.Request.Context(), c.MustGet("account").(identity.Account).ID, false, n)
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
	protected.GET("/ops/comments", func(c *gin.Context) {
		if !ops(c) {
			return
		}
		n, ok := cursor(c)
		if !ok {
			return
		}
		out, e := store.ManagedComments(c.Request.Context(), c.MustGet("account").(identity.Account).ID, true, n)
		reply(c, out, e)
	})
	protected.POST("/ops/comments/:id/actions", func(c *gin.Context) {
		if !ops(c) {
			return
		}
		id, ok := idOf(c)
		if !ok {
			return
		}
		var in publication.CommentAction
		if c.ShouldBindJSON(&in) != nil || (in.Action != "block" && in.Action != "unblock") {
			publicationError(c, publication.ErrInvalid)
			return
		}
		out, e := store.ActOnComment(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id, true, in)
		reply(c, out, e)
	})
}
