package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func TestChapterCommentsRightsVisibilityAndRecovery(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	s := novel.Store{DB: db}
	owner, other, operator := uuid.New(), uuid.New(), uuid.New()
	ids := []uuid.UUID{owner, other, operator}
	tokens := map[uuid.UUID]string{}
	for _, id := range ids {
		if _, err = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "正式资料测试"); err != nil {
			t.Fatal(err)
		}
		tokens[id] = strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
		if err = insertLegacySession(ctx, db, id, tokens[id]); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for _, q := range []string{"DELETE a FROM chapter_comment_actions a JOIN chapter_comments c ON c.id=a.comment_id WHERE c.novel_id IN(SELECT id FROM novels WHERE owner_id=?)", "UPDATE chapter_comments SET root_id=NULL,reply_to=NULL WHERE novel_id IN(SELECT id FROM novels WHERE owner_id=?)", "DELETE FROM chapter_comments WHERE novel_id IN(SELECT id FROM novels WHERE owner_id=?)"} {
			if _, e := db.Exec(q, owner[:]); e != nil {
				t.Error(e)
			}
		}
		for _, id := range ids {
			if _, e := db.Exec("DELETE FROM chapter_comment_mutations WHERE actor_id=?", id[:]); e != nil {
				t.Error(e)
			}
		}

		for _, id := range ids {
			for _, q := range []string{"DELETE FROM novel_notice_deliveries WHERE account_id=?", "DELETE FROM novel_notices WHERE account_id=?", "DELETE FROM novel_shelf_requests WHERE account_id=?", "DELETE FROM novel_shelves WHERE account_id=?", "DELETE FROM novel_reading_requests WHERE account_id=?", "DELETE FROM novel_reading_positions WHERE account_id=?", "DELETE FROM novel_author_policy_events WHERE actor_id=?", "DELETE FROM novel_management_requests WHERE actor_id=?", "DELETE FROM novel_publication_requests WHERE owner_id=?"} {
				if _, e := db.Exec(q, id[:]); e != nil {
					t.Errorf("receipt cleanup: %v", e)
				}
			}
		}
		for _, id := range ids {
			for _, q := range []string{
				"DELETE a FROM novel_moderation_appeals a JOIN novel_moderation_cases c ON c.id=a.case_id WHERE c.owner_id=?", "DELETE FROM novel_moderation_cases WHERE owner_id=?",
				"DELETE FROM novel_metadata_versions WHERE owner_id=?", "DELETE FROM novel_metadata_submissions WHERE owner_id=?",
				"DELETE FROM chapter_release_events WHERE owner_id=?", "DELETE FROM chapter_post_review_tasks WHERE owner_id=?", "DELETE FROM chapter_versions WHERE owner_id=?", "DELETE FROM chapter_submissions WHERE owner_id=?", "DELETE FROM chapter_previews WHERE owner_id=?", "DELETE FROM novel_publications WHERE owner_id=?",
				"UPDATE novel_chapters SET primary_draft_id=NULL WHERE owner_id=?", "UPDATE chapter_drafts SET recovered_from_id=NULL WHERE owner_id=?", "DELETE FROM chapter_draft_mutations WHERE owner_id=?", "DELETE FROM chapter_drafts WHERE owner_id=?", "DELETE FROM novel_chapters WHERE owner_id=?", "DELETE FROM novel_mutations WHERE owner_id=?", "DELETE FROM novels WHERE owner_id=?", "DELETE FROM publication_policies WHERE owner_id=?", "DELETE FROM sessions WHERE account_id=?", "DELETE FROM accounts WHERE id=?",
			} {
				if _, e := db.Exec(q, id[:]); e != nil {
					t.Errorf("fixture cleanup: %v", e)
				}
			}
		}
	}()
	r := gin.New()
	if err = (API{DB: db, Drafts: draft.Store{DB: db}, Identity: &identity.Service{DB: db, Pepper: []byte(strings.Repeat("x", 32))}, Origin: "http://localhost:3000", EnablePublications: true, OperatorAccounts: operator.String()}).Register(r); err != nil {
		t.Fatal(err)
	}
	call := func(method, path string, body any, who uuid.UUID, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
		req.Header.Set("Origin", "http://localhost:3000")
		req.Header.Set("Content-Type", "application/json")
		if who != uuid.Nil {
			req.AddCookie(&http.Cookie{Name: "tako_session", Value: tokens[who]})
		}
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		validateResponse(t, req, out)
		if out.Code != want {
			var failure struct {
				Error string `json:"error"`
			}
			json.Unmarshal(out.Body.Bytes(), &failure)
			t.Fatalf("%s status %d want %d code %s", method, out.Code, want, failure.Error)
		}
		return out.Body.Bytes()
	}

	book, err := s.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: "书架合成书", Tags: []string{"日常"}})
	if err != nil {
		t.Fatal(err)
	}
	chapter := uuid.New()
	ds := draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: chapter}}
	d, e := ds.Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "第一章", Content: "😀甲乙\r\n\r\n末尾\r"})
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: d.Revision, BookRevision: book.Revision})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true}); e != nil {
		t.Fatal(e)
	}

	root := "/api/novels/" + book.ID.String() + "/chapters/" + chapter.String() + "/comments"
	type loaded struct {
		novel.PublicNovelChapter
		Context string `json:"comment_context"`
	}
	read := novelResult[loaded](t, call("GET", strings.TrimSuffix(root, "/comments"), nil, uuid.Nil, 200))
	if read.Context == "" {
		t.Fatal("missing reading context")
	}
	age := func() {
		t.Helper()
		for _, id := range ids {
			if _, e := db.Exec("UPDATE chapter_comments SET created_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 2 MINUTE) WHERE author_id=?", id[:]); e != nil {
				t.Fatal(e)
			}
		}
	}
	create := func(who uuid.UUID, target *uuid.UUID) novel.ChapterCommentResult {
		t.Helper()
		age()
		return novelResult[novel.ChapterCommentResult](t, call("POST", root, novel.ChapterCommentCreate{MutationID: uuid.New(), ExpectedAccountID: who, Content: "合成评论😀", ReplyTo: target, Context: read.Context}, who, 200))
	}
	action := func(id uuid.UUID, rev uint64, kind string, who uuid.UUID) novel.ChapterCommentResult {
		t.Helper()
		path := "/api/chapter-comments/" + id.String() + "/actions"
		if kind != "delete" {
			path = "/api/ops/chapter-comments/" + id.String() + "/actions"
		}
		return novelResult[novel.ChapterCommentResult](t, call("POST", path, novel.ChapterCommentAction{MutationID: uuid.New(), ExpectedAccountID: who, ExpectedRevision: rev, Action: kind, Reason: "合成管理原因"}, who, 200))
	}
	first := novel.ChapterCommentCreate{MutationID: uuid.New(), ExpectedAccountID: other, Content: "原始请求", Context: read.Context}
	original := novelResult[novel.ChapterCommentResult](t, call("POST", root, first, other, 200))
	again := novelResult[novel.ChapterCommentResult](t, call("POST", root, first, other, 200))
	if !reflect.DeepEqual(original, again) {
		t.Fatal("receipt changed")
	}
	first.Content = "不同正文"
	call("POST", root, first, other, 409)
	first.Content = "原始请求"
	call("POST", root, first, uuid.Nil, 401)
	bad := first
	bad.MutationID = uuid.New()
	bad.ExpectedAccountID = owner
	call("POST", root, bad, other, 400)
	bad.ExpectedAccountID = other
	bad.Context = "wrong"
	call("POST", root, bad, other, 409)
	child := create(owner, &original.ID)
	grand := create(operator, &child.ID)
	replies := novelResult[novel.ChapterCommentPage](t, call("GET", root+"?root="+original.ID.String(), nil, uuid.Nil, 200))
	if len(replies.Items) != 2 || *replies.Items[1].RootID != original.ID || *replies.Items[1].ReplyTo != child.ID {
		t.Fatal("not flattened two levels")
	}
	call("POST", "/api/chapter-comments/"+child.ID.String()+"/actions", novel.ChapterCommentAction{MutationID: uuid.New(), ExpectedAccountID: other, ExpectedRevision: 1, Action: "delete"}, other, 404)
	action(original.ID, 1, "delete", other)
	if len(novelResult[novel.ChapterCommentPage](t, call("GET", root, nil, uuid.Nil, 200)).Items) != 0 {
		t.Fatal("root deletion left public replies")
	}
	call("GET", root+"?root="+original.ID.String(), nil, uuid.Nil, 404)
	if _, e = s.CreateChapterComment(ctx, owner, book.ID, chapter, 1, novel.ChapterCommentCreate{MutationID: uuid.New(), ExpectedAccountID: owner, Content: "晚回复", ReplyTo: &grand.ID}); e == nil {
		t.Fatal("deleted target accepted")
	}
	parent := create(other, nil)
	a := create(owner, &parent.ID)
	b := create(operator, &parent.ID)
	action(parent.ID, 1, "block", operator)
	call("GET", root+"?root="+parent.ID.String(), nil, uuid.Nil, 404)
	mine := novelResult[novel.ChapterCommentPage](t, call("GET", "/api/my/chapter-comments", nil, other, 200))
	foundReason := false
	for _, c := range mine.Items {
		if c.ID == parent.ID && c.Blocked && c.Reason != "" {
			foundReason = true
		}
	}
	if !foundReason {
		t.Fatal("own reason missing")
	}
	authorPage := novelResult[novel.ChapterCommentPage](t, call("GET", "/api/my/novels/"+book.ID.String()+"/chapter-comments", nil, owner, 200))
	for _, c := range authorPage.Items {
		if !c.CanDelete {
			t.Fatal("author cannot manage own book")
		}
		if c.AuthorID != owner && c.Reason != "" {
			t.Fatal("author saw private other-user cause")
		}
	}
	call("GET", "/api/my/novels/"+book.ID.String()+"/chapter-comments", nil, other, 404)
	action(a.ID, 1, "delete", owner)
	action(b.ID, 1, "block", operator)
	action(parent.ID, 2, "unblock", operator)
	replies = novelResult[novel.ChapterCommentPage](t, call("GET", root+"?root="+parent.ID.String(), nil, uuid.Nil, 200))
	if len(replies.Items) != 0 {
		t.Fatal("deleted or independently blocked reply revived")
	}
	action(b.ID, 2, "unblock", operator)
	replies = novelResult[novel.ChapterCommentPage](t, call("GET", root+"?root="+parent.ID.String(), nil, uuid.Nil, 200))
	if len(replies.Items) != 1 || replies.Items[0].ID != b.ID {
		t.Fatal("normal reply not restored")
	}
	// Ordinary revisions keep an earlier normal reading context valid.
	updated, e := ds.Write(ctx, owner, "save", draft.Write{MutationID: uuid.New(), DraftID: d.DraftID, BaseRevision: d.Revision, Title: "正式新标题", Content: "正式新正文"})
	if e != nil {
		t.Fatal(e)
	}
	next, e := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: updated.Revision, BookRevision: book.Revision})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: next.PreviewID, RightsConfirmed: true}); e != nil {
		t.Fatal(e)
	}
	create(other, nil)
	if _, e = db.Exec("UPDATE chapter_versions SET platform_limited=TRUE WHERE chapter_id=? AND version=2", chapter[:]); e != nil {
		t.Fatal(e)
	}
	blocked := novel.ChapterCommentCreate{MutationID: uuid.New(), ExpectedAccountID: other, Content: "不应公开", Context: read.Context}
	call("POST", root, blocked, other, 404)
	call("GET", root, nil, uuid.Nil, 404)
	if _, e = db.Exec("UPDATE chapter_versions SET platform_limited=(version=1) WHERE chapter_id=?", chapter[:]); e != nil {
		t.Fatal(e)
	}
	call("POST", root, blocked, other, 409)
	if len(novelResult[novel.ChapterCommentPage](t, call("GET", root, nil, uuid.Nil, 200)).Items) == 0 {
		t.Fatal("old version restriction removed normal comments")
	}
	if _, e = db.Exec("UPDATE chapter_versions SET platform_limited=FALSE WHERE chapter_id=?", chapter[:]); e != nil {
		t.Fatal(e)
	}
	// Delete-root and new-reply share the book lock, leaving no public orphan.
	raceRoot := create(other, nil)
	age()
	var wg sync.WaitGroup
	wg.Add(2)
	errs := make(chan error, 2)
	go func() {
		defer wg.Done()
		_, err := s.ActOnChapterComment(ctx, other, raceRoot.ID, false, novel.ChapterCommentAction{MutationID: uuid.New(), ExpectedAccountID: other, ExpectedRevision: 1, Action: "delete"})
		errs <- err
	}()
	go func() {
		defer wg.Done()
		_, err := s.CreateChapterComment(ctx, owner, book.ID, chapter, 2, novel.ChapterCommentCreate{MutationID: uuid.New(), ExpectedAccountID: owner, Content: "竞争回复", ReplyTo: &raceRoot.ID})
		if err != nil && err != novel.ErrCommentConflict {
			errs <- err
		}
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	call("GET", root+"?root="+raceRoot.ID.String(), nil, uuid.Nil, 404)
	// A genuine other chapter cannot use the original token or root.
	secondChapter := uuid.New()
	secondDraft, err := (draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: book.ID, ChapterID: secondChapter}}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "另一个章节", Content: "另一章正文"})
	if err != nil {
		t.Fatal(err)
	}
	secondPreview, err := s.PrepareChapter(ctx, owner, book.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: secondDraft.DraftID, SourceRevision: secondDraft.Revision, BookRevision: book.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SubmitChapter(ctx, owner, book.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: secondPreview.PreviewID, RightsConfirmed: true}); err != nil {
		t.Fatal(err)
	}
	secondRoot := "/api/novels/" + book.ID.String() + "/chapters/" + secondChapter.String() + "/comments"
	secondRead := novelResult[loaded](t, call("GET", strings.TrimSuffix(secondRoot, "/comments"), nil, uuid.Nil, 200))
	call("POST", secondRoot, novel.ChapterCommentCreate{MutationID: uuid.New(), ExpectedAccountID: other, Content: "跨章token", Context: read.Context}, other, 409)
	call("POST", secondRoot, novel.ChapterCommentCreate{MutationID: uuid.New(), ExpectedAccountID: other, Content: "跨章回复", Context: secondRead.Context, ReplyTo: &parent.ID}, other, 404)
	call("GET", secondRoot+"?root="+parent.ID.String(), nil, uuid.Nil, 404)
	// Pagination and a real account-wide rate limit, not a disabled production limit.
	for i := 0; i < 23; i++ {
		create(operator, nil)
	}
	page := novelResult[novel.ChapterCommentPage](t, call("GET", root, nil, uuid.Nil, 200))
	if len(page.Items) != 20 || page.Next == 0 {
		t.Fatal("root pagination missing")
	}
	tail := novelResult[novel.ChapterCommentPage](t, call("GET", root+"?cursor="+fmt.Sprint(page.Next), nil, uuid.Nil, 200))
	if len(tail.Items) == 0 {
		t.Fatal("root tail missing")
	}
	age()
	for i := 0; i < 5; i++ {
		call("POST", root, novel.ChapterCommentCreate{MutationID: uuid.New(), ExpectedAccountID: owner, Content: "限频合成", Context: read.Context}, owner, 200)
	}
	call("POST", root, novel.ChapterCommentCreate{MutationID: uuid.New(), ExpectedAccountID: owner, Content: "第六次", Context: read.Context}, owner, 429)
	if _, e = db.Exec("UPDATE novels SET author_hidden=TRUE WHERE id=?", book.ID[:]); e != nil {
		t.Fatal(e)
	}
	call("GET", root, nil, uuid.Nil, 404)
	call("GET", "/api/my/chapter-comments", nil, other, 200)
	action(parent.ID, 3, "delete", other)
	call("GET", "/api/ops/chapter-comments", nil, other, 403)
	call("GET", "/api/ops/chapter-comments", nil, operator, 200)
}
