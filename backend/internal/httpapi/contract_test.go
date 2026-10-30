package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/gin-gonic/gin"
	"writing.local/community/internal/contract"
	"writing.local/community/internal/identity"
)

func validateResponse(t *testing.T, request *http.Request, response *httptest.ResponseRecorder) {
	t.Helper()
	router, err := contract.Router()
	if err != nil {
		t.Fatal(err)
	}
	input, err := contract.Input(router, request)
	if err != nil {
		t.Fatal(err)
	}
	err = openapi3filter.ValidateResponse(context.Background(), &openapi3filter.ResponseValidationInput{RequestValidationInput: input, Options: &openapi3filter.Options{IncludeResponseStatus: true}, Status: response.Code, Header: response.Header(), Body: io.NopCloser(bytes.NewReader(response.Body.Bytes()))})
	if err != nil {
		t.Fatalf("response violates OpenAPI (%s %s %d): %v", request.Method, request.URL.Path, response.Code, err)
	}
}

func TestContractRouteCoverage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if err := (API{Identity: &identity.Service{}, Origin: "http://localhost:3000", EnableDocs: true}).Register(r); err != nil {
		t.Fatal(err)
	}
	doc, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	implemented := map[string]bool{}
	for _, route := range r.Routes() {
		if !strings.HasPrefix(route.Path, "/api/") {
			continue
		}
		path := strings.ReplaceAll(strings.ReplaceAll(route.Path, ":id", "{id}"), ":number", "{number}")
		item := doc.Paths.Value(path)
		if item == nil || item.GetOperation(route.Method) == nil {
			t.Fatalf("undocumented route: %s %s", route.Method, path)
		}
		implemented[route.Method+" "+path] = true
	}
	for path, item := range doc.Paths.Map() {
		for method := range item.Operations() {
			if !implemented[method+" "+path] {
				t.Fatalf("documented but missing: %s %s", method, path)
			}
		}
	}
}

func TestSchemaRejectionAndErrorEnvelope(t *testing.T) {
	r := gin.New()
	if err := (API{Identity: &identity.Service{}, Origin: "http://localhost:3000"}).Register(r); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"email":null}`, `{"email":"a@example.com","unexpected":true}`, `{"email":"a@example.com"} {"email":"b@example.com"}`, strings.Repeat(" ", 2<<20) + `{}`} {
		request := httptest.NewRequest("POST", "/api/auth/code", strings.NewReader(body))
		request.Header.Set("Origin", "http://localhost:3000")
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		r.ServeHTTP(response, request)
		if response.Code != 400 && response.Code != 413 {
			t.Fatalf("bad input got %d", response.Code)
		}
		validateResponse(t, request, response)
		var envelope map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope["request_id"] != response.Header().Get("X-Request-ID") {
			t.Fatal("request ID not correlated")
		}
	}
}

func TestResponseValidatorDetectsDrift(t *testing.T) {
	router, err := contract.Router()
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "/api/me", nil)
	input, err := contract.Input(router, request)
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct {
		status int
		body   string
	}{{200, `{"nickname":"missing id"}`}, {418, `{"error":"teapot"}`}} {
		err = openapi3filter.ValidateResponse(context.Background(), &openapi3filter.ResponseValidationInput{RequestValidationInput: input, Options: &openapi3filter.Options{IncludeResponseStatus: true}, Status: fixture.status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(fixture.body))})
		if err == nil {
			t.Fatalf("validator missed drift: %d", fixture.status)
		}
	}
}

func TestDocsExplicitlyEnabled(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		r := gin.New()
		if err := (API{Identity: &identity.Service{}, Origin: "http://localhost:3000", EnableDocs: enabled}).Register(r); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{"/docs/", "/openapi.json", "/docs/assets/swagger-ui-bundle.js"} {
			request := httptest.NewRequest("GET", path, nil)
			response := httptest.NewRecorder()
			r.ServeHTTP(response, request)
			want := 404
			if enabled {
				want = 200
			}
			if response.Code != want {
				t.Fatalf("enabled=%v %s status=%d", enabled, path, response.Code)
			}
		}
	}
}
