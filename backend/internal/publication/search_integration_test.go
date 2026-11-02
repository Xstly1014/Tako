package publication_test

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"writing.local/community/internal/draft"
	. "writing.local/community/internal/publication"
)

func searchWork(t *testing.T, s Store, owner uuid.UUID, title, intro, body string) (uuid.UUID, Result) {
	t.Helper()
	ctx := context.Background()
	d, err := (draft.Store{DB: s.DB}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: title, Content: body})
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.Prepare(ctx, owner, Prepare{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: 1, Introduction: intro, Tags: []string{"幻想"}, RightsConfirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID})
	if err != nil {
		t.Fatal(err)
	}
	return d.DraftID, result
}
func TestSearchPublicMetadataLiteralMatchingAndVersionVisibility(t *testing.T) {
	s, owner, _, _ := setup(t)
	ctx := context.Background()
	marker := uuid.NewString()
	author := marker + "Author"
	if _, err := s.DB.Exec("UPDATE accounts SET nickname=? WHERE id=?", author, owner[:]); err != nil {
		t.Fatal(err)
	}
	d, work := searchWork(t, s, owner, marker+` 100%_!\AbC`, marker+"简介", marker+"正文独有")
	expect := func(q string, present bool) {
		t.Helper()
		page, err := s.Search(ctx, q, "")
		if err != nil || (findCard(page.Items, work.WorkID) != nil) != present {
			t.Fatal("search match/visibility mismatch", err)
		}
	}
	expect("  "+marker+` 100%_!\abc `, true)
	expect(strings.ToUpper(author), true)
	expect(marker+"简介", true)
	expect(marker+"正文独有", false)
	expect(marker+" ' OR 1=1 --", false)
	// Punctuation is literal; it cannot match this row as a wildcard.
	expect(marker+" 100__", false)
	saved, err := (draft.Store{DB: s.DB}).Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: d, BaseRevision: 1, Title: marker + "新版", Content: "合成新版正文"})
	if err != nil {
		t.Fatal(err)
	}
	expect(marker+"新版", false)
	preview, err := s.Prepare(ctx, owner, Prepare{MutationID: uuid.New(), DraftID: d, SourceRevision: saved.Revision, Introduction: marker + "新简介", Tags: []string{"科幻"}, RightsConfirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	expect(marker+"新版", false)
	if _, err = s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: preview.ID, ExpectedVersion: 1}); err != nil {
		t.Fatal(err)
	}
	expect(marker+` 100%_!\abc`, false)
	expect(marker+"新版", true)
	old := uint64(1)
	change(t, s, owner, work.WorkID, "switch_display", &old, nil)
	expect(marker+` 100%_!\abc`, true)
	expect(marker+"新版", false)
	change(t, s, owner, work.WorkID, "hide", nil, nil)
	expect(marker, false)
	change(t, s, owner, work.WorkID, "restore", nil, nil)
	expect(marker+"新版", true)
	for _, field := range []string{"work", "version"} {
		query := "UPDATE works SET platform_limited=? WHERE id=?"
		if field == "version" {
			query = "UPDATE work_versions SET platform_limited=? WHERE work_id=? AND version=2"
		}
		if _, err = s.DB.Exec(query, true, work.WorkID[:]); err != nil {
			t.Fatal(err)
		}
		expect(marker, false)
		if _, err = s.DB.Exec(query, false, work.WorkID[:]); err != nil {
			t.Fatal(err)
		}
	}
	expect(marker+"新版", true)
	if _, err = s.DB.Exec("UPDATE accounts SET nickname=? WHERE id=?", marker+"Renamed", owner[:]); err != nil {
		t.Fatal(err)
	}
	expect(author, false)
	expect(marker+"renamed", true)
}
func TestSearchStablePaginationAndQueryBoundCursor(t *testing.T) {
	s, owner, _, _ := setup(t)
	ctx := context.Background()
	marker := uuid.NewString()
	ids := map[uuid.UUID]bool{}
	for i := 0; i < 14; i++ {
		_, w := searchWork(t, s, owner, marker+"分页", "简介", "正文")
		ids[w.WorkID] = true
	}
	if _, err := s.DB.Exec("UPDATE work_versions v JOIN works w ON w.id=v.work_id SET v.published_at='2026-10-01 00:00:00' WHERE w.owner_id=?", owner[:]); err != nil {
		t.Fatal(err)
	}
	first, err := s.Search(ctx, marker, "")
	if err != nil || len(first.Items) != 12 || first.NextCursor == "" {
		t.Fatal("first page", err)
	}
	second, err := s.Search(ctx, marker, first.NextCursor)
	if err != nil || len(second.Items) != 2 || second.NextCursor != "" {
		t.Fatal("second page", err)
	}
	for _, page := range []SearchPage{first, second} {
		for _, w := range page.Items {
			if !ids[w.ID] {
				t.Fatal("duplicate/unrelated result")
			}
			delete(ids, w.ID)
		}
	}
	if len(ids) != 0 {
		t.Fatal("missing results")
	}
	for _, item := range []struct{ q, c string }{{marker + "other", first.NextCursor}, {marker, "bad"}, {marker, base64.RawURLEncoding.EncodeToString([]byte(`{}`))}} {
		if _, err := s.Search(ctx, item.q, item.c); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid cursor accepted")
		}
	}
	// The cursor contains only a query digest, not plaintext history.
	decoded, _ := base64.RawURLEncoding.DecodeString(first.NextCursor)
	if strings.Contains(string(decoded), marker) {
		t.Fatal("raw query in cursor")
	}
}
func TestSearchRejectsInvalidInputAndRespectsCancellation(t *testing.T) {
	s, _, _, _ := setup(t)
	for _, q := range []string{"", "  ", strings.Repeat("字", 65), "内\n部", "\n首尾", string([]byte{255})} {
		if _, err := s.Search(context.Background(), q, ""); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid query accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.Search(ctx, "取消", ""); err == nil {
		t.Fatal("cancelled search succeeded")
	}
}
