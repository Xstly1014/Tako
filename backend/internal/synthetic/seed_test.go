package synthetic

import (
	"context"
	"github.com/google/uuid"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSeedRefusesNonSandboxBeforeConnecting(t *testing.T) {
	for _, item := range []struct{ dsn, environment string }{
		{"writing:password@tcp(127.0.0.1:1)/writing", "test"},
		{"tako_test:password@tcp(127.0.0.1:1)/tako_sandbox", "production"},
		{"root:password@tcp(127.0.0.1:1)/tako_sandbox", "test"},
		{"writing:password@tcp(127.0.0.1:1)/writing_test", "test"},
	} {
		err := Run(context.Background(), Config{DSN: item.dsn, Environment: item.environment}, nil)
		if err == nil || err.Error() != "seed_target_rejected" {
			t.Fatal("unprotected target was not rejected")
		}
	}
}
func TestGeneratedTextFitsPublishedFields(t *testing.T) {
	ns := uuid.MustParse("14b7c702-4a80-4d76-9bea-de292305aa31")
	if AccountID(ns, 0) == AccountID(ns, 1) || AccountID(ns, 1) == WorkID(ns, 1) {
		t.Fatal("synthetic identifier collision")
	}
	for i := 1; i <= 20000; i++ {
		title, body := versionText(i, 12)
		if !utf8.ValidString(title) || utf8.RuneCountInString(title) > 200 || len(body) > 1<<20 || !strings.Contains(body, "合成测试内容") {
			t.Fatal("invalid text fixture")
		}
		if utf8.RuneCountInString(introduction(i)) > 300 || utf8.RuneCountInString(authorName(i%1000)) > 64 {
			t.Fatal("metadata limit exceeded")
		}
	}
}
