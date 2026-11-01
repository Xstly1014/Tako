package httpapi

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func (a API) registerFavorites(protected *gin.RouterGroup) {
	s := publication.Store{DB: a.DB}
	gate := func(c *gin.Context) bool {
		if !a.EnablePublications {
			respondError(c, 503, "publication_disabled")
			return false
		}
		return true
	}
	protected.GET("/my/favorites", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		out, e := s.Favorites(c.Request.Context(), c.MustGet("account").(identity.Account).ID, c.Query("cursor"))
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.GET("/my/favorites/:id", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		id, e := uuid.Parse(c.Param("id"))
		if e != nil || id == uuid.Nil {
			publicationError(c, publication.ErrNotFound)
			return
		}
		out, e := s.Favorite(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
	protected.POST("/my/favorites/:id", func(c *gin.Context) {
		if !gate(c) {
			return
		}
		id, e := uuid.Parse(c.Param("id"))
		if e != nil || id == uuid.Nil {
			publicationError(c, publication.ErrNotFound)
			return
		}
		var in publication.FavoriteChange
		if c.ShouldBindJSON(&in) != nil {
			publicationError(c, publication.ErrInvalid)
			return
		}
		out, e := s.ChangeFavorite(c.Request.Context(), c.MustGet("account").(identity.Account).ID, id, in)
		if e != nil {
			publicationError(c, e)
			return
		}
		c.JSON(200, out)
	})
}
