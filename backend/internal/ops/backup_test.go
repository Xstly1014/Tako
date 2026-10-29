package ops

import (
	"encoding/json"
	"slices"
	"testing"
	"time"
)

func TestBackupStatusDetectsFailureAndAvoidsNormalRunAlarm(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		name             string
		success, attempt any
		state, want      string
	}{
		{"healthy", now, now, "", ""},
		{"failed", now, now, "backup_failed", "backup_failed"},
		{"overdue", now.Add(-27 * time.Hour), now, "", "backup_overdue"},
		{"first run", nil, now, "in_progress", ""},
		{"stuck first run", nil, now.Add(-11 * time.Minute), "in_progress", "backup_stuck"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, _ := json.Marshal(map[string]any{"last_success": tc.success, "last_attempt": tc.attempt, "last_error": tc.state})
			issues := BackupIssues(data, now)
			if tc.want == "" && len(issues) != 0 {
				t.Fatalf("false alarm: %v", issues)
			}
			if tc.want != "" && !slices.Contains(issues, tc.want) {
				t.Fatalf("missing alarm: %v", issues)
			}
		})
	}
	if !slices.Contains(BackupIssues([]byte("invalid"), now), "backup_status_unreadable") {
		t.Fatal("corrupt status ignored")
	}
}
