package publication_test

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"sync"
	"testing"
	. "writing.local/community/internal/publication"
)

func TestFavoritePaginationAndHiddenRestore(t *testing.T) {
	s, _, reader, _, first := published(t)
	ctx := context.Background()
	ids := []uuid.UUID{first.WorkID}
	for i := 0; i < 22; i++ {
		_, _, _, _, r := published(t)
		ids = append(ids, r.WorkID)
	}
	t.Cleanup(func() {
		s.DB.Exec("DELETE FROM favorite_mutations WHERE account_id=?", reader[:])
		s.DB.Exec("DELETE FROM work_favorites WHERE account_id=?", reader[:])
	})
	for _, id := range ids {
		if _, e := s.ChangeFavorite(ctx, reader, id, FavoriteChange{MutationID: uuid.New(), ExpectedAccountID: reader, Favorite: true}); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := s.DB.Exec("UPDATE work_favorites SET saved_at='2026-01-01 00:00:00' WHERE account_id=?", reader[:]); e != nil {
		t.Fatal(e)
	}
	page, e := s.Favorites(ctx, reader, "")
	if e != nil || len(page.Items) != 20 || page.NextCursor == "" {
		t.Fatal("first page", e)
	}
	tail, e := s.Favorites(ctx, reader, page.NextCursor)
	if e != nil || len(tail.Items) != 3 || tail.NextCursor != "" {
		t.Fatal("tail page", e)
	}
	seen := map[uuid.UUID]bool{}
	for _, x := range append(page.Items, tail.Items...) {
		if seen[x.WorkID] {
			t.Fatal("duplicate")
		}
		seen[x.WorkID] = true
	}
	if _, e = s.Favorites(ctx, reader, "not-a-cursor"); !errors.Is(e, ErrInvalid) {
		t.Fatal("cursor", e)
	}
	s.DB.Exec("UPDATE works SET author_hidden=TRUE WHERE id=?", first.WorkID[:])
	s.DB.Exec("UPDATE works SET author_hidden=FALSE WHERE id=?", first.WorkID[:])
	state, e := s.Favorite(ctx, reader, first.WorkID)
	if e != nil || !state.Favorite || state.Revision != 1 {
		t.Fatal("restore lost favorite", e)
	}
}

func TestFavoriteReceiptsVisibilityAndRace(t *testing.T) {
	s, owner, reader, _, r := published(t)
	ctx := context.Background()
	id := r.WorkID
	t.Cleanup(func() {
		s.DB.Exec("DELETE FROM favorite_mutations WHERE account_id IN (?,?)", owner[:], reader[:])
		s.DB.Exec("DELETE FROM work_favorites WHERE work_id=?", id[:])
	})
	in := FavoriteChange{MutationID: uuid.New(), ExpectedAccountID: reader, Favorite: true}
	a, e := s.ChangeFavorite(ctx, reader, id, in)
	if e != nil || !a.Favorite || a.Revision != 1 {
		t.Fatal("favorite", e)
	}
	duplicate, e := s.ChangeFavorite(ctx, reader, id, in)
	if e != nil || duplicate != a {
		t.Fatal("receipt", e)
	}
	s.DB.Exec("UPDATE accounts SET nickname='' WHERE id=?", reader[:])
	cancel := FavoriteChange{MutationID: uuid.New(), ExpectedAccountID: reader, ExpectedRevision: 1}
	b, e := s.ChangeFavorite(ctx, reader, id, cancel)
	if e != nil || b.Favorite || b.Revision != 2 {
		t.Fatal("cancel", e)
	}
	s.ChangeFavorite(ctx, reader, id, in)
	state, _ := s.Favorite(ctx, reader, id)
	if state.Favorite {
		t.Fatal("old receipt resurrected favorite")
	}
	changed := in
	changed.Favorite = false
	if _, e = s.ChangeFavorite(ctx, reader, id, changed); !errors.Is(e, ErrKeyReuse) {
		t.Fatal("key reuse", e)
	}
	cross := in
	cross.MutationID = uuid.New()
	cross.ExpectedRevision = 2
	if _, e = s.ChangeFavorite(ctx, owner, id, cross); !errors.Is(e, ErrFavoriteConflict) {
		t.Fatal("account changed", e)
	}
	var wg sync.WaitGroup
	wg.Add(2)
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			defer wg.Done()
			x := in
			x.MutationID = uuid.New()
			x.ExpectedRevision = 2
			_, e := s.ChangeFavorite(ctx, reader, id, x)
			results <- e
		}()
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for e := range results {
		if e == nil {
			success++
		} else if errors.Is(e, ErrFavoriteConflict) {
			conflict++
		} else {
			t.Fatal(e)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatal("concurrent stale write", success, conflict)
	}
	page, e := s.Favorites(ctx, reader, "")
	if e != nil || len(page.Items) != 1 || page.Items[0].Work == nil {
		t.Fatal("public favorite", e)
	}
	other, _ := s.Favorites(ctx, owner, "")
	if len(other.Items) != 0 {
		t.Fatal("cross account list")
	}
	for _, condition := range []string{"author_hidden=TRUE", "platform_limited=TRUE"} {
		s.DB.Exec("UPDATE works SET "+condition+" WHERE id=?", id[:])
		page, e = s.Favorites(ctx, reader, "")
		raw, _ := json.Marshal(page)
		if e != nil || len(page.Items) != 1 || page.Items[0].Work != nil || strings.Contains(string(raw), "第七站") {
			t.Fatal("private metadata", e)
		}
		s.DB.Exec("UPDATE works SET author_hidden=FALSE,platform_limited=FALSE WHERE id=?", id[:])
	}
	s.DB.Exec("UPDATE work_versions SET platform_limited=TRUE WHERE work_id=?", id[:])
	page, _ = s.Favorites(ctx, reader, "")
	if page.Items[0].Work != nil {
		t.Fatal("restricted display leaked")
	}
	state, _ = s.Favorite(ctx, reader, id)
	x := FavoriteChange{MutationID: uuid.New(), ExpectedAccountID: reader, ExpectedRevision: state.Revision, Favorite: false}
	if _, e = s.ChangeFavorite(ctx, reader, id, x); e != nil {
		t.Fatal("cancel unavailable", e)
	}
	x.MutationID = uuid.New()
	x.ExpectedRevision++
	x.Favorite = true
	if _, e = s.ChangeFavorite(ctx, reader, id, x); !errors.Is(e, ErrNotFound) {
		t.Fatal("new restricted favorite", e)
	}
	s.DB.Exec("UPDATE work_versions SET platform_limited=FALSE WHERE work_id=?", id[:])
	if _, e = s.ChangeFavorite(ctx, reader, id, x); e != nil {
		t.Fatal("restore", e)
	}
	faulty := Store{DB: failureDB(t, "INSERT INTO favorite_mutations(")}
	state, _ = s.Favorite(ctx, reader, id)
	x.MutationID = uuid.New()
	x.ExpectedRevision = state.Revision
	x.Favorite = false
	if _, e = faulty.ChangeFavorite(ctx, reader, id, x); e == nil {
		t.Fatal("failed receipt accepted")
	}
	after, _ := s.Favorite(ctx, reader, id)
	if after != state {
		t.Fatal("partial commit")
	}
}
