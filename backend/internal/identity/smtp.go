package identity

import (
	"context"
	"errors"
	mail "github.com/wneessen/go-mail"
	"net"
	stdmail "net/mail"
	"strings"
	"time"
)

type SMTP struct {
	Host, Username, Password, From string
	Port                           int
	ImplicitTLS                    bool
}

func (s SMTP) Validate() error {
	if s.Host == "" || strings.TrimSpace(s.Host) != s.Host || strings.ContainsAny(s.Host, "/\r\n ") || (strings.Contains(s.Host, ":") && net.ParseIP(s.Host) == nil) {
		return errors.New("smtp_host_invalid")
	}
	if s.Port < 1 || s.Port > 65535 {
		return errors.New("smtp_port_invalid")
	}
	if _, err := stdmail.ParseAddress(s.From); err != nil || strings.ContainsAny(s.From, "\r\n") {
		return errors.New("smtp_sender_invalid")
	}
	if (s.Username == "") != (s.Password == "") {
		return errors.New("smtp_credentials_incomplete")
	}
	return nil
}

func (s SMTP) Send(ctx context.Context, to, code string) error {
	if s.Host == "" || s.From == "" {
		return ErrUnavailable
	}
	if err := s.Validate(); err != nil {
		return err
	}
	options := []mail.Option{mail.WithPort(s.Port), mail.WithTimeout(15 * time.Second), mail.WithTLSPolicy(mail.TLSMandatory)}
	if s.ImplicitTLS {
		options = append(options, mail.WithSSL())
	}
	if s.Username != "" {
		options = append(options, mail.WithSMTPAuth(mail.SMTPAuthPlain), mail.WithUsername(s.Username), mail.WithPassword(s.Password))
	}
	client, err := mail.NewClient(s.Host, options...)
	if err != nil {
		return errors.New("smtp_configuration_invalid")
	}
	message := mail.NewMsg()
	if err = message.From(s.From); err != nil {
		return errors.New("smtp_sender_invalid")
	}
	if err = message.To(to); err != nil {
		return ErrInvalid
	}
	message.Subject("Tako 登录验证码")
	message.SetBodyString(mail.TypeTextPlain, "你的登录验证码是："+code+"\n有效期以请求页面为准；延迟或重复送达不会延长有效期。如果不是你本人请求，请忽略此邮件。")
	if err = client.DialAndSendWithContext(ctx, message); err != nil {
		return ErrUnavailable
	}
	return nil
}
