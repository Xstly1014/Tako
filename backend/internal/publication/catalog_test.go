package publication_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"writing.local/community/internal/draft"
	. "writing.local/community/internal/publication"
)

func TestCatalogRejectsBadQueryBeforeDatabase(t *testing.T) {
	for _, q := range []AuthorCatalogQuery{{Query: strings.Repeat("😀", 65)}, {Query: "a\nb"}, {Query: string([]byte{0xff})}, {Visibility: "public"}, {Restriction: "unknown"}} {
		if _, err := (Store{}).AuthorCatalog(context.Background(), uuid.New(), q, ""); !errors.Is(err, ErrInvalid) {
			t.Fatal("invalid catalog query accepted")
		}
	}
	if _, err := (Store{}).AuthorCatalog(context.Background(), uuid.New(), AuthorCatalogQuery{}, "bad"); !errors.Is(err, ErrInvalid) {
		t.Fatal("invalid cursor accepted")
	}
}

func TestAuthorCatalogFullQueryAndScopedPagination(t *testing.T) {
	s, owner, _, _ := setup(t)
	otherStore, otherOwner, _, _ := setup(t)
	ctx := context.Background()
	create := func(store Store, account uuid.UUID, title string) (uuid.UUID, uuid.UUID) {
		t.Helper()
		d, err := (draft.Store{DB: store.DB}).Write(ctx, account, "create", draft.Write{MutationID: uuid.New(), Title: title, Content: "body-only-catalog-term"})
		if err != nil {
			t.Fatal(err)
		}
		// Historical synthetic catalog, not 55 same-hour publications. Keep the
		// production 30/hour capacity guard intact; exercise new publication below.
		id, preview, mutation := uuid.New(), uuid.New(), uuid.New()
		tx, err := store.DB.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if _, err = tx.Exec("INSERT INTO works(id,owner_id,source_draft_id,last_version,display_version,created_at) VALUES(?,?,?,1,1,'2020-01-02 00:00:00')", id[:], account[:], d.DraftID[:]); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec("INSERT INTO publication_previews(id,owner_id,mutation_id,payload_hash,draft_id,source_revision,expected_version,title,content,introduction,tags,created_at,expires_at,consumed_work_id,consumed_version,consumed_at) VALUES(?,?,?,UNHEX(SHA2('synthetic-catalog',256)),?,1,0,?,'body-only-catalog-term','',JSON_ARRAY('日常'),'2020-01-02','2020-01-03',?,1,'2020-01-02')", preview[:], account[:], mutation[:], d.DraftID[:], title, id[:]); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec("INSERT INTO work_versions(work_id,version,preview_id,title,content,introduction,tags,published_at) VALUES(?,1,?,?,'body-only-catalog-term','',JSON_ARRAY('日常'),'2020-01-02')", id[:], preview[:], title); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		return id, d.DraftID
	}
	ids := []uuid.UUID{}
	var firstDraft uuid.UUID
	for i := 0; i < 55; i++ {
		title := fmt.Sprintf("Catalog %02d", i)
		if i == 0 {
			title = "old unique display"
		}
		if i == 1 {
			title = "literal 100%_\\ match"
		}
		id, d := create(s, owner, title)
		ids = append(ids, id)
		if i == 0 {
			firstDraft = d
		}
	}
	create(otherStore, otherOwner, "Catalog foreign")
	if _, err := s.DB.Exec("UPDATE works SET created_at='2020-01-01 00:00:00' WHERE id=? AND owner_id=?", ids[0][:], owner[:]); err != nil {
		t.Fatal(err)
	}
	all := AuthorCatalogQuery{}
	page, err := s.AuthorCatalog(ctx, owner, all, "")
	if err != nil || len(page.Items) != 20 || page.NextCursor == "" {
		t.Fatal("first catalog page", err)
	}
	seen := map[uuid.UUID]bool{}
	for _, item := range page.Items {
		seen[item.ID] = true
	}
	cursor := page.NextCursor
	for cursor != "" {
		next, e := s.AuthorCatalog(ctx, owner, all, cursor)
		if e != nil {
			t.Fatal(e)
		}
		for _, item := range next.Items {
			if seen[item.ID] {
				t.Fatal("repeated item")
			}
			seen[item.ID] = true
		}
		cursor = next.NextCursor
	}
	if len(seen) != 55 {
		t.Fatal("incomplete owner catalog")
	}
	for _, q := range []AuthorCatalogQuery{{Query: "CATALOG"}, {Visibility: "hidden"}, {Restriction: "restricted"}} {
		if _, e := s.AuthorCatalog(ctx, owner, q, page.NextCursor); !errors.Is(e, ErrInvalid) {
			t.Fatal("cursor reused with new criteria")
		}
	}
	if _, e := s.AuthorCatalog(ctx, otherOwner, all, page.NextCursor); !errors.Is(e, ErrInvalid) {
		t.Fatal("cursor crossed accounts")
	}
	for _, term := range []string{"%", "_", "\\"} {
		p, e := s.AuthorCatalog(ctx, owner, AuthorCatalogQuery{Query: term}, "")
		if e != nil || len(p.Items) != 1 || p.Items[0].ID != ids[1] {
			t.Fatal("wildcard was not literal", e)
		}
	}
	if p, e := s.AuthorCatalog(ctx, owner, AuthorCatalogQuery{Query: "body-only-catalog-term"}, ""); e != nil || len(p.Items) != 0 {
		t.Fatal("body was searched")
	}
	if _, e := (draft.Store{DB: s.DB}).Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: firstDraft, BaseRevision: 1, Title: "latest unique title", Content: "revised"}); e != nil {
		t.Fatal(e)
	}
	p, e := s.Prepare(ctx, owner, Prepare{MutationID: uuid.New(), DraftID: firstDraft, SourceRevision: 2, Tags: []string{"日常"}, RightsConfirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID, ExpectedVersion: 1}); e != nil {
		t.Fatal(e)
	}
	v := uint64(1)
	change(t, s, owner, ids[0], "switch_display", &v, nil)
	for _, term := range []string{"old unique", "latest unique"} {
		p, e := s.AuthorCatalog(ctx, owner, AuthorCatalogQuery{Query: term}, "")
		if e != nil || len(p.Items) != 1 || p.Items[0].Title != "old unique display" || p.Items[0].LatestTitle != "latest unique title" {
			t.Fatal("display/latest title matching", e)
		}
	}
	change(t, s, owner, ids[3], "hide", nil, nil)
	if _, e := s.DB.Exec("UPDATE work_versions SET platform_limited=1 WHERE work_id=? AND version=1", ids[3][:]); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec("UPDATE works SET platform_limited=1 WHERE id=? AND owner_id=?", ids[4][:], owner[:]); e != nil {
		t.Fatal(e)
	}
	restricted, e := s.AuthorCatalog(ctx, owner, AuthorCatalogQuery{Restriction: "restricted"}, "")
	if e != nil || len(restricted.Items) != 2 {
		t.Fatal("both restriction levels", e)
	}
	hidden, e := s.AuthorCatalog(ctx, owner, AuthorCatalogQuery{Visibility: "hidden", Restriction: "restricted"}, "")
	if e != nil || len(hidden.Items) != 1 || !hidden.Items[0].DisplayLimited || hidden.Items[0].PlatformLimited {
		t.Fatal("restriction intersection", e)
	}
	shown, e := s.AuthorCatalog(ctx, owner, AuthorCatalogQuery{Visibility: "shown"}, "")
	if e != nil {
		t.Fatal(e)
	}
	anchor := shown.Items[len(shown.Items)-1].ID
	change(t, s, owner, anchor, "hide", nil, nil)
	if _, e = s.AuthorCatalog(ctx, owner, AuthorCatalogQuery{Visibility: "shown"}, shown.NextCursor); e != nil {
		t.Fatal("changed anchor broke live pagination", e)
	}
	legacy, e := s.AuthorWorks(ctx, owner, "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = uuid.Parse(legacy.NextCursor); e != nil {
		t.Fatal("legacy cursor changed")
	}
}
