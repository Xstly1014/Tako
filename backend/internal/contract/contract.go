package contract

import (
	"context"
	_ "embed"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/legacy"
)

//go:embed openapi.yaml
var Source []byte

func Load() (*openapi3.T, error) {
	loader := openapi3.NewLoader()
	doc, err := loader.LoadFromData(Source)
	if err != nil {
		return nil, err
	}
	if err = doc.Validate(context.Background()); err != nil {
		return nil, err
	}
	return doc, nil
}

func Router() (routers.Router, error) {
	doc, err := Load()
	if err != nil {
		return nil, err
	}
	return legacy.NewRouter(doc)
}

func Input(router routers.Router, request *http.Request) (*openapi3filter.RequestValidationInput, error) {
	route, params, err := router.FindRoute(request)
	if err != nil {
		return nil, err
	}
	return &openapi3filter.RequestValidationInput{Request: request, PathParams: params, Route: route, Options: &openapi3filter.Options{
		// Schema validation does NOT grant access. Cookie verification is performed
		// by the protected Gin group after this middleware.
		AuthenticationFunc: openapi3filter.NoopAuthenticationFunc, IncludeResponseStatus: true,
	}}, nil
}
