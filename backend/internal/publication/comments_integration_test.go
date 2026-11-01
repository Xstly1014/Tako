package publication_test

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"sync"
	"testing"
	. "writing.local/community/internal/publication"
)

func cleanupComments(t *testing.T, s Store, work uuid.UUID, actors ...uuid.UUID) {
	t.Helper()
	t.Cleanup(func() {
		s.DB.Exec("DELETE a FROM comment_actions a JOIN work_comments c ON c.id=a.comment_id WHERE c.work_id=?", work[:])
		for _, id := range actors {
			s.DB.Exec("DELETE FROM comment_mutations WHERE actor_id=?", id[:])
		}
		s.DB.Exec("DELETE FROM work_comments WHERE work_id=? AND root_id IS NOT NULL ORDER BY sequence DESC", work[:])
		s.DB.Exec("DELETE FROM work_comments WHERE work_id=?", work[:])
	})
}
func TestCommentThreadsDeletionModerationAndRace(t *testing.T) {
	s, owner, reader, _, r := published(t)
	ctx := context.Background()
	cleanupComments(t, s, r.WorkID, owner, reader)
	create := func(actor uuid.UUID, target *uuid.UUID) (CommentResult, CommentCreate) {
		t.Helper()
		in := CommentCreate{MutationID: uuid.New(), ExpectedAccountID: actor, Content: "纯文本 <b>不会变成 HTML</b>", ReplyTo: target, Context: "test-internal-context"}
		out, e := s.CreateComment(ctx, actor, r.WorkID, 1, in)
		if e != nil {
			t.Fatal(e)
		}
		return out, in
	}
	root, rootInput := create(owner, nil)
	child, _ := create(reader, &root.ID)
	nested, _ := create(reader, &child.ID)
	list, e := s.Comments(ctx, r.WorkID, root.ID, reader, 0)
	if e != nil || len(list.Items) != 2 || *list.Items[1].RootID != root.ID || *list.Items[1].ReplyTo != child.ID {
		t.Fatal("flat reply thread", e)
	}
	act := func(id uuid.UUID, action string) CommentResult {
		t.Helper()
		var revision uint64
		s.DB.QueryRow("SELECT revision FROM work_comments WHERE id=?", id[:]).Scan(&revision)
		out, e := s.ActOnComment(ctx, owner, id, true, CommentAction{MutationID: uuid.New(), ExpectedAccountID: owner, ExpectedRevision: revision, Action: action, Reason: "测试处置原因"})
		if e != nil {
			t.Fatal(e)
		}
		return out
	}
	act(child.ID, "block")
	act(root.ID, "block")
	list, e = s.Comments(ctx, r.WorkID, uuid.Nil, reader, 0)
	if e != nil || len(list.Items) != 0 {
		t.Fatal("blocked root exposed", e)
	}
	if _, e = s.Comments(ctx, r.WorkID, root.ID, reader, 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("blocked thread read", e)
	}
	bad := CommentCreate{MutationID: uuid.New(), ExpectedAccountID: reader, Content: "不能回复屏蔽串", ReplyTo: &nested.ID}
	if _, e = s.CreateComment(ctx, reader, r.WorkID, 1, bad); !errors.Is(e, ErrCommentConflict) {
		t.Fatal("reply into blocked thread", e)
	}
	act(root.ID, "unblock")
	list, e = s.Comments(ctx, r.WorkID, root.ID, reader, 0)
	if e != nil || len(list.Items) != 1 || list.Items[0].ID != nested.ID {
		t.Fatal("independent block lost", e)
	}
	// Hidden reply target names are not emitted through a surviving reply.
	if list.Items[0].ReplyName != "" {
		t.Fatal("blocked target identity exposed")
	}
	invalid := CommentAction{MutationID: uuid.New(), ExpectedAccountID: reader, ExpectedRevision: 1, Action: "delete"}
	if _, e = s.ActOnComment(ctx, reader, root.ID, false, invalid); !errors.Is(e, ErrNotFound) {
		t.Fatal("third party deleted root", e)
	}
	// Body publication and receipt persistence are one real database transaction.
	faulty := Store{DB: failureDB(t, "INSERT INTO comment_mutations(")}
	count := func() int {
		var n int
		s.DB.QueryRow("SELECT COUNT(*) FROM work_comments WHERE work_id=?", r.WorkID[:]).Scan(&n)
		return n
	}
	before := count()
	if _, e = faulty.CreateComment(ctx, reader, r.WorkID, 1, CommentCreate{MutationID: uuid.New(), ExpectedAccountID: reader, Content: "rollback"}); e == nil || count() != before {
		t.Fatal("partial creation after receipt failure", e)
	}
	// Work lock orders reply insertion against root deletion.
	var revision uint64
	s.DB.QueryRow("SELECT revision FROM work_comments WHERE id=?", root.ID[:]).Scan(&revision)
	var wg sync.WaitGroup
	wg.Add(2)
	failures := make(chan error, 2)
	go func() {
		defer wg.Done()
		_, e := s.ActOnComment(ctx, owner, root.ID, false, CommentAction{MutationID: uuid.New(), ExpectedAccountID: owner, ExpectedRevision: revision, Action: "delete"})
		failures <- e
	}()
	go func() {
		defer wg.Done()
		_, e := s.CreateComment(ctx, reader, r.WorkID, 1, CommentCreate{MutationID: uuid.New(), ExpectedAccountID: reader, Content: "并发回复", ReplyTo: &root.ID})
		if errors.Is(e, ErrCommentConflict) {
			e = nil
		}
		failures <- e
	}()
	wg.Wait()
	close(failures)
	for e := range failures {
		if e != nil {
			t.Fatal(e)
		}
	}
	var alive int
	s.DB.QueryRow("SELECT COUNT(*) FROM work_comments WHERE work_id=? AND deleted=FALSE", r.WorkID[:]).Scan(&alive)
	if alive != 0 {
		t.Fatal("reply survived cascade")
	}
	act(root.ID, "unblock")
	list, e = s.Comments(ctx, r.WorkID, uuid.Nil, reader, 0)
	if e != nil || len(list.Items) != 0 {
		t.Fatal("undo resurrected deleted thread", e)
	}
	replay, e := s.CreateComment(ctx, owner, r.WorkID, 1, rootInput)
	if e != nil || replay.ID != root.ID || count() < before {
		t.Fatal("replay changed result", e)
	}
}
func TestCommentOldReadPermissionAndNoStoredVersion(t *testing.T) {
	s, owner, reader, draftID, r := published(t)
	ctx := context.Background()
	cleanupComments(t, s, r.WorkID, owner, reader)
	preview := prepare(t, s, owner, draftID)
	if _, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: preview.ID, ExpectedVersion: 1}); e != nil {
		t.Fatal(e)
	}
	// Closing history does not revoke permission to comment on already loaded normal text.
	s.DB.Exec("UPDATE works SET history_open=FALSE WHERE id=?", r.WorkID[:])
	in := CommentCreate{MutationID: uuid.New(), ExpectedAccountID: reader, Content: "作品级评论"}
	if _, e := s.CreateComment(ctx, reader, r.WorkID, 1, in); e != nil {
		t.Fatal(e)
	}
	s.DB.Exec("UPDATE work_versions SET platform_limited=TRUE WHERE work_id=? AND version=1", r.WorkID[:])
	in.MutationID = uuid.New()
	if _, e := s.CreateComment(ctx, reader, r.WorkID, 1, in); !errors.Is(e, ErrVersionUnavailable) {
		t.Fatal("restricted loaded text posted", e)
	}
	s.DB.Exec("UPDATE work_versions SET platform_limited=FALSE WHERE work_id=?", r.WorkID[:])
	s.DB.Exec("UPDATE works SET author_hidden=TRUE WHERE id=?", r.WorkID[:])
	if _, e := s.CreateComment(ctx, reader, r.WorkID, 1, in); !errors.Is(e, ErrNotFound) {
		t.Fatal("hidden work posted", e)
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='work_comments' AND column_name LIKE '%version%'").Scan(&n)
	if n != 0 {
		t.Fatal("stored comment version")
	}
}

func TestCommentPaginationAndRateLimit(t *testing.T) {
	s, owner, reader, _, r := published(t)
	ctx := context.Background()
	cleanupComments(t, s, r.WorkID, owner, reader)
	var roots []CommentResult
	for i := 0; i < 21; i++ {
		if i%5 == 0 {
			s.DB.Exec("UPDATE work_comments SET created_at=UTC_TIMESTAMP(6)-INTERVAL 2 MINUTE WHERE work_id=?", r.WorkID[:])
		}
		out, e := s.CreateComment(ctx, owner, r.WorkID, 1, CommentCreate{MutationID: uuid.New(), ExpectedAccountID: owner, Content: "分页测试"})
		if e != nil {
			t.Fatal(e)
		}
		roots = append(roots, out)
	}
	page, e := s.Comments(ctx, r.WorkID, uuid.Nil, uuid.Nil, 0)
	if e != nil || len(page.Items) != 20 || page.Next == 0 {
		t.Fatal("root page", e)
	}
	tail, e := s.Comments(ctx, r.WorkID, uuid.Nil, uuid.Nil, page.Next)
	if e != nil || len(tail.Items) != 1 || tail.Next != 0 || tail.Items[0].ID != roots[0].ID {
		t.Fatal("root tail", e)
	}
	var first CommentCreate
	for i := 0; i < 5; i++ {
		in := CommentCreate{MutationID: uuid.New(), ExpectedAccountID: reader, Content: "限流测试", ReplyTo: &roots[0].ID}
		if i == 0 {
			first = in
		}
		if _, e = s.CreateComment(ctx, reader, r.WorkID, 1, in); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.CreateComment(ctx, reader, r.WorkID, 1, first); e != nil {
		t.Fatal("retry consumed rate budget", e)
	}
	if _, e = s.CreateComment(ctx, reader, r.WorkID, 1, CommentCreate{MutationID: uuid.New(), ExpectedAccountID: reader, Content: "第六次"}); !errors.Is(e, ErrCommentLimited) {
		t.Fatal("rate gate", e)
	}
}
