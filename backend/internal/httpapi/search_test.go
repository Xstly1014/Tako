package httpapi

import (
	"bytes"
	"database/sql"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"writing.local/community/internal/identity"
)

func TestSearchDisabledUnavailableAndQueryNotLogged(t *testing.T) {
	db, err := sql.Open("mysql", "fixture:fixture@tcp(127.0.0.1:1)/writing_search_test")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, enabled := range []bool{false, true} {
		var logs bytes.Buffer
		r := gin.New()
		if err = (API{DB: db, Identity: &identity.Service{DB: db}, Origin: "http://localhost:3000", EnablePublications: enabled, Logger: slog.New(slog.NewJSONHandler(&logs, nil))}).Register(r); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest("GET", "/api/search?q=PRIVATE_SEARCH_SENTINEL", nil)
		response := httptest.NewRecorder()
		r.ServeHTTP(response, request)
		validateResponse(t, request, response)
		code := "publication_disabled"
		if enabled {
			code = "service_unavailable"
		}
		if response.Code != 503 || !strings.Contains(response.Body.String(), code) {
			t.Fatal("wrong unavailable semantics")
		}
		if strings.Contains(logs.String(), "PRIVATE_SEARCH_SENTINEL") || strings.Contains(response.Body.String(), "PRIVATE_SEARCH_SENTINEL") {
			t.Fatal("raw query leaked")
		}
		if !strings.Contains(logs.String(), `"route":"/api/search"`) || !strings.Contains(logs.String(), `"request_id"`) {
			t.Fatal("missing safe diagnostic")
		}
	}
}
