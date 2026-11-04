package publication_test

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"testing"
	"writing.local/community/internal/draft"
	. "writing.local/community/internal/publication"
)

func TestAuthorFeedbackVisibilityAndReplyStatus(t *testing.T) {
	s, owner, reader, _, r := published(t)
	ctx := context.Background()
	cleanupComments(t, s, r.WorkID, owner, reader)
	create := func(actor uuid.UUID, target *uuid.UUID) CommentResult {
		t.Helper()
		out, e := s.CreateComment(ctx, actor, r.WorkID, 1, CommentCreate{MutationID: uuid.New(), ExpectedAccountID: actor, Content: "收件箱反馈", ReplyTo: target})
		if e != nil {
			t.Fatal("create feedback", e)
		}
		return out
	}
	root := create(reader, nil)
	page, e := s.AuthorFeedback(ctx, owner, true, 0)
	if e != nil || len(page.Items) != 1 || !page.Items[0].AwaitingAuthor || !page.Items[0].Comment.CanDelete || page.Items[0].Comment.Reason != "" {
		t.Fatal("initial inbox", e)
	}
	if p, e := s.AuthorFeedback(ctx, reader, false, 0); e != nil || len(p.Items) != 0 {
		t.Fatal("other account inbox", e)
	}
	if _, e = s.AuthorFeedbackThread(ctx, reader, root.ID); !errors.Is(e, ErrNotFound) {
		t.Fatal("other account thread", e)
	}
	reply := create(owner, &root.ID)
	if p, e := s.AuthorFeedback(ctx, owner, true, 0); e != nil || len(p.Items) != 0 {
		t.Fatal("reply did not leave awaiting", e)
	}
	if p, e := s.AuthorFeedback(ctx, owner, false, 0); e != nil || len(p.Items) != 1 || p.Items[0].AwaitingAuthor {
		t.Fatal("all lost answered root", e)
	}
	if _, e = s.AuthorFeedbackThread(ctx, owner, reply.ID); !errors.Is(e, ErrNotFound) {
		t.Fatal("reply used as root", e)
	}
	if _, e = s.ActOnComment(ctx, owner, reply.ID, false, CommentAction{MutationID: uuid.New(), ExpectedAccountID: owner, ExpectedRevision: 1, Action: "delete"}); e != nil {
		t.Fatal(e)
	}
	if p, e := s.AuthorFeedback(ctx, owner, true, 0); e != nil || len(p.Items) != 1 {
		t.Fatal("deleted reply still answers", e)
	}
	reply = create(owner, &root.ID)
	if _, e = s.ActOnComment(ctx, owner, reply.ID, true, CommentAction{MutationID: uuid.New(), ExpectedAccountID: owner, ExpectedRevision: 1, Action: "block", Reason: "合成屏蔽原因"}); e != nil {
		t.Fatal(e)
	}
	if p, e := s.AuthorFeedback(ctx, owner, true, 0); e != nil || len(p.Items) != 1 || p.Items[0].Comment.Replies != 0 || p.Items[0].Comment.Reason != "" {
		t.Fatal("blocked reply or reason leaked", e)
	}
	assertHidden := func() {
		t.Helper()
		p, e := s.AuthorFeedback(ctx, owner, false, 0)
		if e != nil || len(p.Items) != 0 {
			t.Fatal("invisible work/comment exposed", e)
		}
		if _, e = s.AuthorFeedbackThread(ctx, owner, root.ID); !errors.Is(e, ErrNotFound) {
			t.Fatal("invisible detail exposed", e)
		}
	}
	for _, target := range []string{"works SET author_hidden=TRUE WHERE id=?", "works SET platform_limited=TRUE WHERE id=?", "work_versions SET platform_limited=TRUE WHERE work_id=?"} {
		if _, e = s.DB.Exec("UPDATE "+target, r.WorkID[:]); e != nil {
			t.Fatal(e)
		}
		assertHidden()
		s.DB.Exec("UPDATE works SET author_hidden=FALSE,platform_limited=FALSE WHERE id=?", r.WorkID[:])
		s.DB.Exec("UPDATE work_versions SET platform_limited=FALSE WHERE work_id=?", r.WorkID[:])
	}
	if _, e = s.ActOnComment(ctx, owner, root.ID, true, CommentAction{MutationID: uuid.New(), ExpectedAccountID: owner, ExpectedRevision: 1, Action: "block", Reason: "根评论屏蔽"}); e != nil {
		t.Fatal(e)
	}
	assertHidden()
}

func TestAuthorFeedbackGlobalPagingAcrossWorks(t *testing.T) {
	s, owner, reader, _, r := published(t)
	ctx := context.Background()
	cleanupComments(t, s, r.WorkID, owner, reader)
	d, e := (draft.Store{DB: s.DB}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "另一本人作品", Content: "合成正文"})
	if e != nil {
		t.Fatal(e)
	}
	p := prepare(t, s, owner, d.DraftID)
	second, e := s.Publish(ctx, owner, Publish{MutationID: uuid.New(), PreviewID: p.ID})
	if e != nil {
		t.Fatal(e)
	}
	cleanupComments(t, s, second.WorkID, owner, reader)
	// Historical rows are a pagination fixture, not successful rate-limited POSTs.
	for i := 0; i < 25; i++ {
		id, w := uuid.New(), r.WorkID
		if i%2 == 1 {
			w = second.WorkID
		}
		if _, e = s.DB.Exec("INSERT INTO work_comments(id,work_id,author_id,content,created_at) VALUES(?,?,?, ?,UTC_TIMESTAMP(6)-INTERVAL 2 MINUTE)", id[:], w[:], reader[:], "历史分页反馈"); e != nil {
			t.Fatal(e)
		}
	}
	first, e := s.AuthorFeedback(ctx, owner, true, 0)
	if e != nil || len(first.Items) != 20 || first.Next == 0 {
		t.Fatal("first page", e)
	}
	last, e := s.AuthorFeedback(ctx, owner, true, first.Next)
	if e != nil || len(last.Items) != 5 || last.Next != 0 {
		t.Fatal("last page", e)
	}
	seen, works := map[uuid.UUID]bool{}, map[uuid.UUID]bool{}
	var before uint64 = MaxSequence
	for _, item := range append(first.Items, last.Items...) {
		if seen[item.Comment.ID] || item.Comment.Sequence >= before {
			t.Fatal("unstable global order")
		}
		seen[item.Comment.ID] = true
		works[item.Comment.WorkID] = true
		before = item.Comment.Sequence
	}
	if len(works) != 2 {
		t.Fatal("inbox only covered one work")
	}
	if _, e = s.AuthorFeedback(ctx, owner, false, MaxSequence+1); !errors.Is(e, ErrInvalid) {
		t.Fatal("unsafe cursor", e)
	}
}
