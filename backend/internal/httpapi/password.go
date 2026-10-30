package httpapi

import (
	"github.com/gin-gonic/gin"
	"writing.local/community/internal/identity"
)

func (a API) registerPasswords(api, protected *gin.RouterGroup) {
	api.GET("/auth/methods", func(c *gin.Context) {
		mode := a.AuthMode
		if mode == "" {
			mode = "email"
		}
		c.JSON(200, gin.H{"mode": mode})
	})
	for _, operation := range []string{"register", "login"} {
		op := operation
		api.POST("/auth/"+op, func(c *gin.Context) {
			if a.AuthMode != "password" {
				respondError(c, 403, "auth_method_disabled")
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
				account, token, err = a.Identity.RegisterPassword(c.Request.Context(), in.Email, in.Password, c.ClientIP())
			} else {
				account, token, err = a.Identity.LoginPassword(c.Request.Context(), in.Email, in.Password, c.ClientIP())
			}
			if err != nil {
				fail(c, err)
				return
			}
			a.cookie(c, token, 7*24*3600)
			c.JSON(200, account)
		})
	}
	protected.GET("/me/password", func(c *gin.Context) {
		account := c.MustGet("account").(identity.Account)
		exists, err := a.Identity.HasPassword(c.Request.Context(), account.ID)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"configured": exists})
	})
	protected.POST("/me/password", func(c *gin.Context) {
		var in struct {
			Password string `json:"password"`
		}
		if c.ShouldBindJSON(&in) != nil {
			respondError(c, 400, "invalid_input")
			return
		}
		account := c.MustGet("account").(identity.Account)
		if err := a.Identity.SetupPassword(c.Request.Context(), account.ID, in.Password, c.ClientIP()); err != nil {
			fail(c, err)
			return
		}
		c.Status(204)
	})
}
