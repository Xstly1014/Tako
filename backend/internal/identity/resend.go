package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

// Resend uses the provider's HTTPS API. Provider responses never reach logs:
// error bodies may contain addresses or other private request details.
type Resend struct {
	APIKey, From string
	client       *http.Client
}

func (s Resend) Validate() error {
	if !strings.HasPrefix(s.APIKey, "re_") || strings.ContainsAny(s.APIKey, " \r\n\t") {
		return errors.New("resend_key_invalid")
	}
	if _, err := mail.ParseAddress(s.From); err != nil || strings.ContainsAny(s.From, "\r\n") {
		return errors.New("resend_sender_invalid")
	}
	return nil
}

func (s Resend) Send(ctx context.Context, to, code string) error {
	return s.SendMessage(ctx, to, "Tako 登录验证码", "你的登录验证码是："+code+"\n有效期以请求页面为准；延迟或重复送达不会延长有效期。如果不是你本人请求，请忽略此邮件。")
}

func (s Resend) SendMessage(ctx context.Context, to, subject, text string) error {
	if err := s.Validate(); err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]any{
		"from": s.From, "to": []string{to}, "subject": subject,
		"text": text,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	req.Header.Set("Content-Type", "application/json")
	client := s.client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	resp, err := client.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != 408 && resp.StatusCode != 429 {
			return errMailRejected
		}
		return ErrUnavailable
	}
	var accepted struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&accepted); err != nil || accepted.ID == "" {
		return ErrUnavailable
	}
	return nil
}

var errMailRejected = errors.New("mail_provider_rejected")
