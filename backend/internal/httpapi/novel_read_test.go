package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/novel"
)

func TestNovelPublicReadingVisibilityAndThousandChapterDirectory(t *testing.T) {
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
	owner := uuid.New()
	if _, err = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", owner[:], owner.String()+"@example.test", "目录合成作者"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		for _, q := range []string{
			"DELETE FROM novel_management_requests WHERE actor_id=?", "DELETE FROM novel_publication_requests WHERE owner_id=?",
			"DELETE a FROM novel_moderation_appeals a JOIN novel_moderation_cases c ON c.id=a.case_id WHERE c.owner_id=?", "DELETE FROM novel_moderation_cases WHERE owner_id=?",
			"DELETE FROM novel_metadata_versions WHERE owner_id=?", "DELETE FROM novel_metadata_submissions WHERE owner_id=?",
			"DELETE FROM chapter_release_events WHERE owner_id=?", "DELETE FROM chapter_post_review_tasks WHERE owner_id=?", "DELETE FROM chapter_versions WHERE owner_id=?", "DELETE FROM chapter_submissions WHERE owner_id=?", "DELETE FROM chapter_previews WHERE owner_id=?", "DELETE FROM novel_publications WHERE owner_id=?",
			"UPDATE novel_chapters SET primary_draft_id=NULL WHERE owner_id=?", "UPDATE chapter_drafts SET recovered_from_id=NULL WHERE owner_id=?", "DELETE FROM chapter_draft_mutations WHERE owner_id=?", "DELETE FROM chapter_drafts WHERE owner_id=?", "DELETE FROM novel_chapters WHERE owner_id=?", "DELETE FROM novel_mutations WHERE owner_id=?", "DELETE FROM novels WHERE owner_id=?", "DELETE FROM accounts WHERE id=?",
		} {
			if _, e := db.Exec(q, owner[:]); e != nil {
				t.Errorf("fixture cleanup: %v", e)
			}
		}
	}()
	r := gin.New()
	if err = (API{DB: db, Identity: &identity.Service{DB: db}, Origin: "http://localhost:3000", EnablePublications: true}).Register(r); err != nil {
		t.Fatal(err)
	}
	call := func(path string, want int) []byte {
		t.Helper()
		req := httptest.NewRequest("GET", path, nil)
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		validateResponse(t, req, out)
		if out.Code != want {
			var failure struct {
				Error string `json:"error"`
			}
			json.Unmarshal(out.Body.Bytes(), &failure)
			t.Fatalf("guest read status %d want %d code %s", out.Code, want, failure.Error)
		}
		return out.Body.Bytes()
	}
	newBook := func(title string) novel.Book {
		t.Helper()
		b, e := s.Write(ctx, owner, uuid.Nil, novel.Write{MutationID: uuid.New(), Title: title, Tags: []string{"幻想"}})
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	publishFirst := func(b novel.Book) uuid.UUID {
		t.Helper()
		chapter := uuid.New()
		d, e := (draft.Store{DB: db, Chapter: &draft.ChapterScope{NovelID: b.ID, ChapterID: chapter}}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: "公开合成第一章", Content: "公开合成正文"})
		if e != nil {
			t.Fatal(e)
		}
		p, e := s.PrepareChapter(ctx, owner, b.ID, novel.PrepareChapter{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: 1, BookRevision: 1})
		if e != nil {
			t.Fatal(e)
		}
		if _, e = s.SubmitChapter(ctx, owner, b.ID, novel.SubmitChapter{MutationID: uuid.New(), PreviewID: p.PreviewID, RightsConfirmed: true}); e != nil {
			t.Fatal(e)
		}
		return chapter
	}
	b := newBook("千章合成作品")
	root := "/api/novels/" + b.ID.String()
	call(root, 404)
	call(root+"/directory", 404)
	firstChapter := publishFirst(b)
	initial := novelResult[novel.PublicNovel](t, call(root, 200))
	if initial.ChapterCount != 1 || initial.Title != b.Title || initial.Author != "目录合成作者" {
		t.Fatal("formal public book projection")
	}
	loaded := novelResult[novel.PublicNovelChapter](t, call(root+"/chapters/"+firstChapter.String(), 200))
	if loaded.Content != "公开合成正文" || loaded.Ordinal != 1 {
		t.Fatal("public first chapter")
	}
	private := newBook("PRIVATE_UNPUBLISHED_SENTINEL")
	call("/api/novels/"+private.ID.String(), 404)
	t.Run("ShortPostPreview", func(t *testing.T) {
		verifyShortPostPreview(t, db, owner, b.ID, private.ID)
	})
	ownBooks := map[uuid.UUID]bool{b.ID: true}
	for n := 0; n < 12; n++ {
		extra := newBook(fmt.Sprintf("分页合成作品%d", n))
		publishFirst(extra)
		ownBooks[extra.ID] = true
	}
	search := func(query, cursor string, status int) novel.PublicNovelPage {
		t.Helper()
		path := "/api/novels/search?q=" + url.QueryEscape(query)
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		raw := call(path, status)
		if status != 200 {
			return novel.PublicNovelPage{}
		}
		return novelResult[novel.PublicNovelPage](t, raw)
	}
	byAuthor := search("目录合成作者", "", 200)
	if len(byAuthor.Items) != 12 || byAuthor.NextCursor == "" {
		t.Fatal("search pagination")
	}
	tail := search(" 目录合成作者 ", byAuthor.NextCursor, 200)
	if len(tail.Items) != 1 || tail.Items[0].ID != b.ID || tail.NextCursor != "" {
		t.Fatal("search stable ordering")
	}
	search("分页合成", byAuthor.NextCursor, 400)
	call("/api/novels?cursor="+url.QueryEscape(byAuthor.NextCursor), 400)
	feed := novelResult[novel.PublicNovelPage](t, call("/api/novels", 200))
	search("目录合成作者", feed.NextCursor, 400)
	for _, q := range []string{"", " ", "abc\n", strings.Repeat("字", 65)} {
		search(q, "", 400)
	}
	for _, q := range []string{"PRIVATE_UNPUBLISHED_SENTINEL", "公开合成正文", "%", "_"} {
		if len(search(q, "", 200).Items) != 0 {
			t.Fatal("search leaked private source or wildcard")
		}
	}
	if _, e := db.Exec("UPDATE novel_publications SET introduction=? WHERE novel_id=?", "LIKE%_!字面标记", b.ID[:]); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec("UPDATE novels SET title=? WHERE id=?", "PRIVATE_REVISED_METADATA", b.ID[:]); e != nil {
		t.Fatal(e)
	}
	literal := search("like%_!", "", 200)
	if len(literal.Items) != 1 || literal.Items[0].ID != b.ID || literal.Items[0].Title != b.Title {
		t.Fatal("search literal/current public metadata")
	}
	if len(search("PRIVATE_REVISED_METADATA", "", 200).Items) != 0 {
		t.Fatal("search included private metadata")
	}
	// Privileged, random-owner read fixtures only. This tests 1,001-row query /
	// pagination behavior, not 1,000 actual publications or production capacity.
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	ids := map[uint64]uuid.UUID{1: firstChapter}
	for n := uint64(2); n <= 1001; n++ {
		chapter, preview, submission := uuid.New(), uuid.New(), uuid.New()
		ids[n] = chapter
		hidden, limited, versionLimited := n%11 == 0, n%10 == 0, n%17 == 0
		title := fmt.Sprintf("合成目录章%d", n)
		if hidden || limited || versionLimited {
			title = "PRIVATE_UNREADABLE_TITLE"
		}
		when := initial.LatestChapterPublishedAt.Add(time.Duration(n) * time.Microsecond)
		p := novel.ChapterPreview{ID: preview, NovelID: b.ID, ChapterID: chapter, DraftID: uuid.New(), SourceRevision: 1, Title: title, Content: "合成目录正文", BookTitle: b.Title, Tags: b.Tags, Ordinal: n, ExpectedLastPosition: n - 1, CandidateVersion: 1, ExpiresAt: when.Add(24 * time.Hour)}
		raw, _ := json.Marshal(p)
		if _, err = tx.Exec("INSERT INTO novel_chapters(id,novel_id,owner_id,ordinal,last_version,display_version,author_hidden,platform_limited) VALUES(?,?,?,?,1,1,?,?)", chapter[:], b.ID[:], owner[:], n, hidden, limited); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec("INSERT INTO chapter_previews(id,owner_id,novel_id,chapter_id,snapshot,expires_at) VALUES(?,?,?,?,?,?)", preview[:], owner[:], b.ID[:], chapter[:], raw, p.ExpiresAt); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec("INSERT INTO chapter_submissions(id,owner_id,novel_id,chapter_id,preview_id,ordinal,candidate_version,state,decided_by,decided_at) VALUES(?,?,?,?,?,?,1,'published',?,?)", submission[:], owner[:], b.ID[:], chapter[:], preview[:], n, owner[:], when); err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec("INSERT INTO chapter_versions(chapter_id,novel_id,owner_id,version,submission_id,title,content,platform_limited,published_at) VALUES(?,?,?,1,?,?,?,?,?)", chapter[:], b.ID[:], owner[:], submission[:], title, "合成目录正文", versionLimited, when); err != nil {
			t.Fatal(err)
		}
	}
	unsubmitted := uuid.New()
	if _, err = tx.Exec("INSERT INTO novel_chapters(id,novel_id,owner_id,ordinal) VALUES(?,?,?,1002)", unsubmitted[:], b.ID[:], owner[:]); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec("UPDATE novels SET last_position=1002 WHERE id=?", b.ID[:]); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	public := novelResult[novel.PublicNovel](t, call(root, 200))
	if public.ChapterCount != 1001 || !public.FirstPublishedAt.Equal(initial.FirstPublishedAt) {
		t.Fatal("reserved count mistaken for formal count")
	}
	seen := map[uuid.UUID]bool{}
	token := ""
	last := uint64(0)
	var firstToken string
	for pageNo := 0; pageNo < 30; pageNo++ {
		raw := call(root+"/directory"+func() string {
			if token == "" {
				return ""
			}
			return "?cursor=" + token
		}(), 200)
		if strings.Contains(string(raw), "PRIVATE_UNREADABLE_TITLE") || strings.Contains(string(raw), "PRIVATE_UNPUBLISHED_SENTINEL") {
			t.Fatal("directory leaked hidden content")
		}
		page := novelResult[novel.DirectoryPage](t, raw)
		if len(page.Items) > 50 {
			t.Fatal("unbounded directory")
		}
		for _, item := range page.Items {
			if seen[item.ID] || item.Ordinal <= last {
				t.Fatal("directory duplicated or reordered")
			}
			if item.Readable != (item.Title != nil) {
				t.Fatal("unsafe placeholder")
			}
			seen[item.ID] = true
			last = item.Ordinal
		}
		if firstToken == "" {
			firstToken = page.NextCursor
		}
		token = page.NextCursor
		if token == "" {
			break
		}
	}
	if len(seen) != 1001 || seen[unsubmitted] || last != 1001 {
		t.Fatal("directory skipped formal chapters or exposed private slot")
	}
	call(root+"/chapters/"+ids[10].String(), 404)
	call(root+"/chapters/"+ids[11].String(), 404)
	call(root+"/chapters/"+ids[17].String(), 404)
	call(root+"/chapters/"+unsubmitted.String(), 404)
	call(root+"/directory?cursor=bad", 400)
	var otherBook uuid.UUID
	for id := range ownBooks {
		if id != b.ID {
			otherBook = id
			break
		}
	}
	call("/api/novels/"+otherBook.String()+"/directory?cursor="+firstToken, 400)
	call("/api/novels/"+otherBook.String()+"/chapters/"+firstChapter.String(), 404)
	books := map[uuid.UUID]bool{}
	token = ""
	for pageNo := 0; pageNo < 10; pageNo++ {
		path := "/api/novels"
		if token != "" {
			path += "?cursor=" + token
		}
		page := novelResult[novel.PublicNovelPage](t, call(path, 200))
		if len(page.Items) > 12 {
			t.Fatal("unbounded book list")
		}
		for _, item := range page.Items {
			if books[item.ID] {
				t.Fatal("book pagination duplicate")
			}
			books[item.ID] = true
			if item.ID == private.ID {
				t.Fatal("private book discovered")
			}
		}
		token = page.NextCursor
		if token == "" {
			break
		}
	}
	for id := range ownBooks {
		if !books[id] {
			t.Fatal("published book omitted")
		}
	}
	state, _ := s.NovelState(ctx, owner, b.ID)
	if _, err = s.ChangeVisibility(ctx, owner, b.ID, uuid.Nil, novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: state.StateRevision, Action: "hide"}); err != nil {
		t.Fatal(err)
	}
	call(root, 404)
	if len(search("千章合成作品", "", 200).Items) != 0 {
		t.Fatal("unreadable book in search")
	}
	call(root+"/directory", 404)
	call(root+"/chapters/"+firstChapter.String(), 404)
	if loaded.Content != "公开合成正文" {
		t.Fatal("already loaded body changed")
	}
	state, _ = s.NovelState(ctx, owner, b.ID)
	if _, err = s.ChangeVisibility(ctx, owner, b.ID, uuid.Nil, novel.VisibilityAction{MutationID: uuid.New(), ExpectedRevision: state.StateRevision, Action: "restore"}); err != nil {
		t.Fatal(err)
	}
	restored := novelResult[novel.PublicNovel](t, call(root, 200))
	if !restored.FirstPublishedAt.Equal(public.FirstPublishedAt) || !restored.LatestChapterPublishedAt.Equal(public.LatestChapterPublishedAt) {
		t.Fatal("restore bumped publication time")
	}
	state, _ = s.NovelState(ctx, owner, b.ID)
	limited, err := s.LimitNovel(ctx, owner, b.ID, novel.LimitNovel{MutationID: uuid.New(), Scope: "book", ExpectedRevision: state.StateRevision, Reason: "测试整书权限"})
	if err != nil {
		t.Fatal(err)
	}
	call(root, 404)
	if len(search("千章合成作品", "", 200).Items) != 0 {
		t.Fatal("unreadable book in search")
	}
	call(root+"/directory", 404)
	call(root+"/chapters/"+firstChapter.String(), 404)
	if _, err = s.DecideNovelCase(ctx, owner, b.ID, limited.ID, novel.NovelCaseAction{MutationID: uuid.New(), ExpectedRevision: 1, Decision: "revoke", Reason: "测试撤销"}); err != nil {
		t.Fatal(err)
	}
	call(root, 200)
}
