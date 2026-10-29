package identity

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type resendTransport func(*http.Request) (*http.Response, error)

func (f resendTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestResendDelivery(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"accepted", 200, `{"id":"mail-id"}`, nil},
		{"rejected", 403, `{"message":"private provider detail"}`, errMailRejected},
		{"rate limit", 429, `{}`, ErrUnavailable},
		{"server failure", 503, `{}`, ErrUnavailable},
		{"timeout status", 408, `{}`, ErrUnavailable},
		{"invalid acknowledgement", 200, `{}`, ErrUnavailable},
		{"malformed acknowledgement", 200, `oops`, ErrUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Resend{APIKey: "re_test", From: "onboarding@resend.dev", client: &http.Client{Transport: resendTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.String() != "https://api.resend.com/emails" || r.Header.Get("Authorization") != "Bearer re_test" || r.Method != "POST" {
					t.Fatal("invalid request")
				}
				var body struct {
					To   []string
					Text string
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.To) != 1 || body.To[0] != "reader@example.test" || !strings.Contains(body.Text, "123456") {
					t.Fatal("invalid mail payload")
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})}}
			if err := s.Send(context.Background(), "reader@example.test", "123456"); !errors.Is(err, tc.want) {
				t.Fatalf("unexpected safe error: %v", err)
			}
		})
	}
}

func TestResendConfigurationAndTransportFailure(t *testing.T) {
	for _, s := range []Resend{{APIKey: "", From: "onboarding@resend.dev"}, {APIKey: "re_bad\n", From: "onboarding@resend.dev"}, {APIKey: "re_test", From: "invalid"}} {
		if s.Validate() == nil {
			t.Fatal("accepted invalid configuration")
		}
	}
	s := Resend{APIKey: "re_test", From: "onboarding@resend.dev", client: &http.Client{Transport: resendTransport(func(r *http.Request) (*http.Response, error) { return nil, errors.New("private transport detail") })}}
	if err := s.Send(context.Background(), "reader@example.test", "123456"); err != ErrUnavailable {
		t.Fatal("transport detail leaked")
	}
}
