package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/contract"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
)

type API struct {
	SessionCookieName  string
	EnvironmentName    string
	AuthMode           string
	Identity           *identity.Service
	Drafts             draft.Store
	DB                 *sql.DB
	Origin             string
	SecureCookie       bool
	Logger             *slog.Logger
	EnableDocs         bool
	EnablePublications bool
	OperatorAccounts   string
}

func (a API) Register(r *gin.Engine) error {
	if a.EnvironmentName != "" && a.EnvironmentName != "local" && a.EnvironmentName != "test" && a.EnvironmentName != "production" {
		return errors.New("APP_ENVIRONMENT must be local, test or production")
	}
	if len(a.sessionCookieName()) > 64 || strings.IndexFunc(a.sessionCookieName(), func(r rune) bool {
		return !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_')
	}) >= 0 {
		return errors.New("SESSION_COOKIE_NAME must contain only letters, digits or underscore")
	}
	if a.AuthMode != "" && a.AuthMode != "email" && a.AuthMode != "password" {
		return errors.New("AUTH_MODE must be email or password")
	}
	parsed, err := url.Parse(a.Origin)
	if err != nil || parsed.Host == "" || parsed.Path != "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return errors.New("APP_ORIGIN must be an exact origin without path")
	}
	if parsed.Scheme != "https" && parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1" {
		return errors.New("non-local origins require HTTPS")
	}
	if parsed.Scheme == "https" && !a.SecureCookie {
		return errors.New("HTTPS requires secure cookies")
	}
	r.SetTrustedProxies(nil)
	router, err := contract.Router()
	if err != nil {
		return err
	}
	if a.EnableDocs {
		doc, err := contract.Load()
		if err != nil {
			return err
		}
		// Swagger must describe this deployment's actual browser-managed cookie.
		if scheme := doc.Components.SecuritySchemes["session"]; scheme != nil && scheme.Value != nil {
			scheme.Value.Name = a.sessionCookieName()
		}
		data, err := json.Marshal(doc)
		if err != nil {
			return err
		}
		r.GET("/openapi.json", func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Data(200, "application/json", data) })
		registerDocs(r)
	}
	api := r.Group("/api")
	api.Use(requestLog(a.Logger))
	api.Use(func(c *gin.Context) {
		environment := a.EnvironmentName
		if environment == "" {
			environment = "local"
		}
		c.Header("X-Tako-Environment", environment)
		c.Header("Cache-Control", "no-store")
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		appEntry := strings.HasPrefix(c.Request.URL.Path, "/api/app/auth/")
		native := c.GetHeader("Authorization") != ""
		// Native credentials never mix with browser authority. A header is not
		// authentication: protected routes still verify the token against MySQL.
		if (appEntry || native) && (c.GetHeader("Origin") != "" || c.GetHeader("Cookie") != "") {
			respondError(c, 403, "origin_rejected")
			return
		}
		if native && strings.HasPrefix(c.Request.URL.Path, "/api/auth/") {
			respondError(c, 403, "origin_rejected")
			return
		}
		if c.Request.Method != "GET" && c.Request.Method != "HEAD" {
			if !appEntry && !native && c.GetHeader("Origin") != a.Origin {
				respondError(c, 403, "origin_rejected")
				return
			}
			mediaType, _, parseErr := mime.ParseMediaType(c.GetHeader("Content-Type"))
			if parseErr != nil || mediaType != "application/json" {
				respondError(c, 415, "json_required")
				return
			}
			body, readErr := io.ReadAll(c.Request.Body)
			if readErr != nil {
				var tooLarge *http.MaxBytesError
				if errors.As(readErr, &tooLarge) {
					respondError(c, 413, "payload_too_large")
				} else {
					respondError(c, 400, "invalid_input")
				}
				return
			}
			if !utf8.Valid(body) || !json.Valid(body) {
				respondError(c, 400, "invalid_input")
				return
			}
			c.Request.Body = io.NopCloser(bytes.NewReader(body))
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		input, validationErr := contract.Input(router, c.Request)
		if validationErr != nil {
			respondError(c, 400, "invalid_input")
			return
		}
		if validationErr = openapi3filter.ValidateRequest(ctx, input); validationErr != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(validationErr, &tooLarge) {
				respondError(c, 413, "payload_too_large")
			} else {
				respondError(c, 400, "invalid_input")
			}
			return
		}
		c.Next()
	})
	api.POST("/auth/code", func(c *gin.Context) {
		if a.AuthMode == "password" {
			respondError(c, 403, "auth_method_disabled")
			return
		}
		var in struct {
			Email      string    `json:"email"`
			DeliveryID uuid.UUID `json:"delivery_id"`
		}
		if c.ShouldBindJSON(&in) != nil {
			fail(c, identity.ErrInvalid)
			return
		}
		delivery, err := a.Identity.Enqueue(c.Request.Context(), in.Email, c.ClientIP(), in.DeliveryID)
		if err != nil {
			fail(c, err)
			return
		}
		c.Set("delivery_id", delivery.ID.String())
		c.JSON(202, delivery)
	})
	api.POST("/auth/verify", func(c *gin.Context) {
		if a.AuthMode == "password" {
			respondError(c, 403, "auth_method_disabled")
			return
		}
		var in struct {
			Email string `json:"email"`
			Code  string `json:"code"`
		}
		if c.ShouldBindJSON(&in) != nil {
			fail(c, identity.ErrInvalid)
			return
		}
		account, token, err := a.Identity.Verify(c.Request.Context(), in.Email, in.Code, c.ClientIP())
		if err != nil {
			fail(c, err)
			return
		}
		a.cookie(c, token, 7*24*3600)
		c.JSON(200, account)
	})
	api.POST("/auth/logout", func(c *gin.Context) {
		token, _ := c.Cookie(a.sessionCookieName())
		if err := a.Identity.Logout(c.Request.Context(), token); err != nil {
			fail(c, err)
			return
		}
		a.cookie(c, "", -1)
		c.Status(204)
	})
	protected := api.Group("")
	protected.Use(func(c *gin.Context) {
		account, err := a.authenticate(c)
		if err != nil {
			if errors.Is(err, identity.ErrInvalid) {
				respondError(c, 401, "authentication_required")
			} else {
				respondError(c, 503, "service_unavailable")
			}
			return
		}
		c.Set("account", account)
		c.Next()
	})
	a.registerPasswords(api, protected)
	a.registerAppPasswords(api)
	protected.GET("/me", func(c *gin.Context) { c.JSON(200, c.MustGet("account")) })
	protected.PATCH("/me", func(c *gin.Context) {
		var in struct {
			Nickname string `json:"nickname"`
		}
		if c.ShouldBindJSON(&in) != nil {
			fail(c, identity.ErrInvalid)
			return
		}
		name := strings.TrimSpace(in.Nickname)
		if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 64 {
			fail(c, identity.ErrInvalid)
			return
		}
		account := c.MustGet("account").(identity.Account)
		_, err := a.DB.ExecContext(c.Request.Context(), "UPDATE accounts SET nickname=? WHERE id=?", name, account.ID[:])
		if err != nil {
			fail(c, err)
			return
		}
		account.Nickname = name
		c.JSON(200, account)
	})
	protected.GET("/drafts", func(c *gin.Context) {
		limit := 20
		if raw := c.Query("limit"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil {
				fail(c, draft.ErrInvalid)
				return
			}
			limit = n
		}
		account := c.MustGet("account").(identity.Account)
		page, err := a.Drafts.List(c.Request.Context(), account.ID, limit, c.Query("cursor"))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, page)
	})
	protected.GET("/drafts/:id", func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			fail(c, draft.ErrNotFound)
			return
		}
		account := c.MustGet("account").(identity.Account)
		d, err := a.Drafts.Read(c.Request.Context(), account.ID, id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, d)
	})
	for _, op := range []string{"create", "save", "recover"} {
		operation := op
		protected.POST("/drafts/"+operation, func(c *gin.Context) {
			var in draft.Write
			if c.ShouldBindJSON(&in) != nil {
				fail(c, draft.ErrInvalid)
				return
			}
			account := c.MustGet("account").(identity.Account)
			if account.Nickname == "" {
				respondError(c, 409, "nickname_required")
				return
			}
			out, err := a.Drafts.Write(c.Request.Context(), account.ID, operation, in)
			if err != nil {
				fail(c, err)
				return
			}
			c.JSON(200, out)
		})
	}
	a.registerPublicationRoutes(api, protected)
	a.registerDiscovery(api, protected)
	a.registerFavorites(protected)
	a.registerComments(api, protected)
	return nil
}
func (a API) cookie(c *gin.Context, token string, maxAge int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(a.sessionCookieName(), token, maxAge, "/", "", a.SecureCookie, true)
}
func (a API) sessionCookieName() string {
	if a.SessionCookieName != "" {
		return a.SessionCookieName
	}
	return "tako_session"
}
func fail(c *gin.Context, err error) {
	status, code := 503, "service_unavailable"
	switch {
	case errors.Is(err, identity.ErrLogin):
		status, code = 401, "invalid_login"
	case errors.Is(err, identity.ErrPassword):
		status, code = 400, "invalid_password"
	case errors.Is(err, identity.ErrAccountExists):
		status, code = 409, "account_exists"
	case errors.Is(err, identity.ErrPasswordSet):
		status, code = 409, "password_already_set"
	case errors.Is(err, identity.ErrInvalid), errors.Is(err, draft.ErrInvalid):
		status, code = 400, "invalid_input"
	case errors.Is(err, identity.ErrLimited):
		status, code = 429, "rate_limited"
		c.Header("Retry-After", "60")
	case errors.Is(err, identity.ErrUnavailable):
		status, code = 503, "mail_unavailable"
	case errors.Is(err, draft.ErrNotFound):
		status, code = 404, "draft_not_found"
	case errors.Is(err, draft.ErrConflict):
		status, code = 409, "revision_conflict"
	case errors.Is(err, draft.ErrKeyReuse):
		status, code = 409, "mutation_id_reused"
	case errors.Is(err, identity.ErrDeliveryReuse):
		status, code = 409, "delivery_id_reused"
	}
	respondError(c, status, code)
}
