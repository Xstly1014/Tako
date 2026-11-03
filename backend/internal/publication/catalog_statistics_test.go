package publication_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	. "writing.local/community/internal/publication"
)

func TestAuthorCatalogStatisticsVisibilityAndIsolation(t *testing.T) {
	s, owner, reader, _, work := published(t)
	ctx := context.Background()
	cleanupComments(t, s, work.WorkID, owner, reader)
	t.Cleanup(func() { s.DB.Exec("DELETE FROM work_favorites WHERE work_id=?", work.WorkID[:]) })
	check := func(comments, favorites uint64) {
		t.Helper()
		page, err := s.AuthorCatalog(ctx, owner, AuthorCatalogQuery{}, "")
		if err != nil || len(page.Items) != 1 || page.Items[0].ID != work.WorkID || page.Items[0].CommentCount != comments || page.Items[0].FavoriteCount != favorites {
			t.Fatalf("catalog statistics mismatch; expected comments=%d favorites=%d, error=%v", comments, favorites, err)
		}
		other, err := s.AuthorCatalog(ctx, reader, AuthorCatalogQuery{}, "")
		if err != nil || len(other.Items) != 0 {
			t.Fatal("reader received author's private catalog statistics", err)
		}
	}
	check(0, 0)
	// Isolated historical rows cover invisible roots with still-visible children,
	// which must never count as accessible comments. No publication/rate reset.
	add := func(root *uuid.UUID, deleted, blocked bool) uuid.UUID {
		t.Helper()
		id := uuid.New()
		var parent any
		if root != nil {
			parent = root[:]
		}
		if _, err := s.DB.Exec("INSERT INTO work_comments(id,work_id,author_id,root_id,reply_to,content,deleted,blocked,created_at) VALUES(?,?,?,?,?,'catalog statistics fixture',?,?,UTC_TIMESTAMP(6))", id[:], work.WorkID[:], reader[:], parent, parent, deleted, blocked); err != nil {
			t.Fatal(err)
		}
		return id
	}
	visible := add(nil, false, false)
	add(&visible, false, false)
	add(&visible, true, false)
	add(&visible, false, true)
	blocked := add(nil, false, true)
	add(&blocked, false, false)
	deleted := add(nil, true, false)
	add(&deleted, false, false)
	for _, actor := range []uuid.UUID{owner, reader} {
		if _, err := s.DB.Exec("INSERT INTO work_favorites(account_id,work_id,active,revision,saved_at) VALUES(?,?,TRUE,1,UTC_TIMESTAMP(6))", actor[:], work.WorkID[:]); err != nil {
			t.Fatal(err)
		}
	}
	check(2, 2)
	if _, err := s.DB.Exec("UPDATE work_favorites SET active=FALSE,revision=revision+1 WHERE account_id=? AND work_id=?", reader[:], work.WorkID[:]); err != nil {
		t.Fatal(err)
	}
	check(2, 1)
	if _, err := s.DB.Exec("UPDATE work_comments SET blocked=FALSE WHERE id=?", blocked[:]); err != nil {
		t.Fatal(err)
	}
	check(4, 1)
	if _, err := s.DB.Exec("UPDATE works SET author_hidden=TRUE,platform_limited=TRUE WHERE id=?", work.WorkID[:]); err != nil {
		t.Fatal(err)
	}
	check(4, 1)
}
