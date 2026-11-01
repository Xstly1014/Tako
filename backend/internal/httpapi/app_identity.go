package httpapi

import (
	"github.com/gin-gonic/gin"
	"strings"
	"writing.local/community/internal/identity"
)

func appToken(c *gin.Context) string {
	value := c.GetHeader("Authorization")
	if !strings.HasPrefix(value, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(value, "Bearer ")
}

func (a API) authenticate(c *gin.Context) (identity.Account, error) {
	if c.GetHeader("Authorization") != "" {
		return a.Identity.AuthenticateApp(c.Request.Context(), appToken(c))
	}
	token, _ := c.Cookie(a.sessionCookieName())
	return a.Identity.Authenticate(c.Request.Context(), token)
}

func (a API) registerAppPasswords(api *gin.RouterGroup) {
	for _, operation := range []string{"register", "login"} {
		op := operation
		api.POST("/app/auth/"+op, func(c *gin.Context) {
			if a.AuthMode != "password" {
				respondError(c, 403, "auth_method_disabled")
				return
			}
			if c.GetHeader("Authorization") != "" {
				respondError(c, 403, "origin_rejected")
				return
			}
			var in struct {
				Email    string `json:"email"`
				Password string `json:"password"`
			}
			if c.ShouldBindJSON(&in) != nil {
				respondError(c, 400, "invalid_input")
				return
			}
			var account identity.Account
			var token string
			var err error
			if op == "register" {
				account, token, err = a.Identity.RegisterAppPassword(c.Request.Context(), in.Email, in.Password, c.ClientIP())
			} else {
				account, token, err = a.Identity.LoginAppPassword(c.Request.Context(), in.Email, in.Password, c.ClientIP())
			}
			if err != nil {
				fail(c, err)
				return
			}
			c.JSON(200, gin.H{"account": account, "access_token": token, "token_type": "Bearer", "expires_in": 604800})
		})
	}
	api.POST("/app/auth/logout", func(c *gin.Context) {
		token := appToken(c)
		// A syntactically valid already-revoked token can be retried after a lost response.
		if len(token) != 73 || !strings.HasPrefix(token, "tako_app_") {
			respondError(c, 401, "authentication_required")
			return
		}
		if err := a.Identity.Logout(c.Request.Context(), token); err != nil {
			fail(c, err)
			return
		}
		c.Status(204)
	})
}
