package novel

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
)

type NovelNotice struct {
	ID               uuid.UUID    `json:"id"`
	NovelID          uuid.UUID    `json:"novel_id"`
	CreatedAt        time.Time    `json:"created_at"`
	ReadAt           *time.Time   `json:"read_at"`
	Book             *PublicNovel `json:"book"`
	ReadableChapters uint64       `json:"readable_chapters"`
}
type NoticePage struct {
	Items      []NovelNotice `json:"items"`
	NextCursor string        `json:"next_cursor"`
}
type NoticeDetail struct {
	Notice     NovelNotice        `json:"notice"`
	Items      []DirectoryChapter `json:"items"`
	NextCursor string             `json:"next_cursor"`
}
type NoticeRead struct {
	ID     uuid.UUID `json:"id"`
	ReadAt time.Time `json:"read_at"`
}
type NoticeBacklog struct {
	Ready         int
	Waiting       int
	ReadyCapped   bool
	WaitingCapped bool
}

const visibleNoticeChapter = `c.last_version>0 AND c.author_hidden=FALSE AND c.platform_limited=FALSE AND v.platform_limited=FALSE`
const noticeEventJoin = ` FROM chapter_release_events e JOIN novel_chapters c ON c.id=e.chapter_id AND c.novel_id=e.novel_id JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.display_version `
const noticeNotCovered = ` NOT EXISTS(SELECT 1 FROM novel_notice_deliveries d WHERE d.account_id=s.account_id AND d.generation=s.generation AND d.chapter_id=e.chapter_id)`
const readyNoticeRecipient = ` FROM novel_shelves s JOIN novels n ON n.id=s.novel_id JOIN novel_publications p ON p.novel_id=n.id WHERE s.in_shelf=TRUE AND s.following=TRUE AND n.author_hidden=FALSE AND n.platform_limited=FALSE AND EXISTS(SELECT 1` + noticeEventJoin + `WHERE e.novel_id=s.novel_id AND e.release_sequence>s.start_sequence AND ` + visibleNoticeChapter + ` AND ` + noticeNotCovered + `)`

// First-release rows are the transaction outbox. Delivery coverage is independent per
// chapter and subscription generation, so a late readable hole cannot be skipped.
func (s Store) DispatchNovelNotices(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > 50 {
		return 0, ErrInvalid
	}
	rows, e := s.DB.QueryContext(ctx, `SELECT s.account_id,s.novel_id`+readyNoticeRecipient+` ORDER BY s.notice_checked_at,s.account_id,s.novel_id LIMIT ?`, limit)
	if e != nil {
		return 0, e
	}
	type target struct{ account, book uuid.UUID }
	targets := []target{}
	for rows.Next() {
		var a, b []byte
		if e = rows.Scan(&a, &b); e != nil {
			rows.Close()
			return 0, e
		}
		account, err := uuid.FromBytes(a)
		if err != nil {
			rows.Close()
			return 0, err
		}
		book, err := uuid.FromBytes(b)
		if err != nil {
			rows.Close()
			return 0, err
		}
		targets = append(targets, target{account, book})
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return 0, e
	}
	sent := 0
	for _, t := range targets {
		ok, err := s.deliverNovelNotice(ctx, t.account, t.book)
		if err != nil {
			return sent, err
		}
		if ok {
			sent++
		}
	}
	return sent, nil
}
func (s Store) deliverNovelNotice(ctx context.Context, reader, book uuid.UUID) (bool, error) {
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if e != nil {
		return false, e
	}
	defer tx.Rollback()
	if e = lockAccount(ctx, tx, reader, false); e != nil {
		return false, e
	}
	var raw []byte
	var hidden, limited bool
	if e = tx.QueryRowContext(ctx, "SELECT id,author_hidden,platform_limited FROM novels WHERE id=? FOR SHARE", book[:]).Scan(&raw, &hidden, &limited); e != nil {
		return false, e
	}
	var member, following bool
	var generation, start uint64
	e = tx.QueryRowContext(ctx, "SELECT in_shelf,following,generation,start_sequence FROM novel_shelves WHERE account_id=? AND novel_id=? FOR UPDATE", reader[:], book[:]).Scan(&member, &following, &generation, &start)
	if errors.Is(e, sql.ErrNoRows) {
		return false, tx.Commit()
	}
	if e != nil {
		return false, e
	}
	if !member || !following || hidden || limited {
		return false, tx.Commit()
	}
	// Holding the book lock freezes publication and all book/chapter governance.
	// A single INSERT SELECT covers the complete currently readable set, not one page.
	q := noticeEventJoin + `LEFT JOIN novel_notice_deliveries covered ON covered.account_id=? AND covered.generation=? AND covered.chapter_id=e.chapter_id WHERE e.novel_id=? AND e.release_sequence>? AND ` + visibleNoticeChapter + ` AND covered.chapter_id IS NULL`
	args := []any{reader[:], generation, book[:], start}
	var count uint64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*)"+q, args...).Scan(&count); e != nil {
		return false, e
	}
	if count == 0 {
		return false, tx.Commit()
	}
	id, now := uuid.New(), time.Now().UTC().Truncate(time.Microsecond)
	if _, e = tx.ExecContext(ctx, "INSERT INTO novel_notices(id,account_id,novel_id,generation,created_at) VALUES(?,?,?,?,?)", id[:], reader[:], book[:], generation, now); e != nil {
		return false, e
	}
	insertArgs := append([]any{reader[:], book[:], generation, id[:]}, args...)
	result, e := tx.ExecContext(ctx, `INSERT INTO novel_notice_deliveries(account_id,novel_id,generation,chapter_id,notice_id) SELECT ?,?,?,e.chapter_id,?`+q, insertArgs...)
	if e != nil {
		return false, e
	}
	affected, e := result.RowsAffected()
	if e != nil {
		return false, e
	}
	if uint64(affected) != count {
		return false, ErrStateConflict
	}
	if _, e = tx.ExecContext(ctx, "UPDATE novel_shelves SET notice_checked_at=? WHERE account_id=? AND novel_id=?", now, reader[:], book[:]); e != nil {
		return false, e
	}
	return true, tx.Commit()
}

// Operational counts are capped recipient counts, not delivered/read-chapter metrics.
func (s Store) NovelNoticeBacklog(ctx context.Context) (NoticeBacklog, error) {
	var out NoticeBacklog
	queries := []string{`SELECT 1` + readyNoticeRecipient + ` LIMIT 501`, `SELECT 1 FROM novel_shelves s JOIN novels n ON n.id=s.novel_id JOIN novel_publications p ON p.novel_id=n.id WHERE s.in_shelf=TRUE AND s.following=TRUE AND EXISTS(SELECT 1` + noticeEventJoin + `WHERE e.novel_id=s.novel_id AND e.release_sequence>s.start_sequence AND ` + noticeNotCovered + ` AND NOT(n.author_hidden=FALSE AND n.platform_limited=FALSE AND ` + visibleNoticeChapter + `)) LIMIT 501`}
	for i, q := range queries {
		rows, e := s.DB.QueryContext(ctx, q)
		if e != nil {
			return out, e
		}
		n := 0
		for rows.Next() {
			n++
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return out, e
		}
		if i == 0 {
			out.ReadyCapped = n > 500
			out.Ready = min(n, 500)
		} else {
			out.WaitingCapped = n > 500
			out.Waiting = min(n, 500)
		}
	}
	return out, nil
}
func scanNotice(row interface{ Scan(...any) error }) (NovelNotice, error) {
	var out NovelNotice
	var a, b []byte
	var read sql.NullTime
	e := row.Scan(&a, &b, &out.CreatedAt, &read)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	out.ID, e = uuid.FromBytes(a)
	if e != nil {
		return out, e
	}
	out.NovelID, e = uuid.FromBytes(b)
	if read.Valid {
		out.ReadAt = &read.Time
	}
	return out, e
}

const noticeColumns = "id,novel_id,created_at,read_at"

func projectNotices(ctx context.Context, tx *sql.Tx, items []NovelNotice) error {
	if len(items) == 0 {
		return nil
	}
	marks := make([]string, len(items))
	bookArgs, noticeArgs := []any{}, []any{}
	byBook := map[uuid.UUID]*PublicNovel{}
	byNotice := map[uuid.UUID]int{}
	for i, v := range items {
		marks[i] = "?"
		bookArgs = append(bookArgs, v.NovelID[:])
		noticeArgs = append(noticeArgs, v.ID[:])
		byNotice[v.ID] = i
	}
	rows, e := tx.QueryContext(ctx, "SELECT "+publicNovelColumns+publicNovelJoin+readableNovel+" AND n.id IN ("+strings.Join(marks, ",")+")", bookArgs...)
	if e != nil {
		return e
	}
	for rows.Next() {
		b, err := scanPublicNovel(rows)
		if err != nil {
			rows.Close()
			return err
		}
		byBook[b.ID] = &b
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for i := range items {
		items[i].Book = byBook[items[i].NovelID]
	}
	q := `SELECT d.notice_id,COUNT(*) FROM novel_notice_deliveries d JOIN novels n ON n.id=d.novel_id JOIN novel_chapters c ON c.id=d.chapter_id AND c.novel_id=d.novel_id JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.display_version WHERE n.author_hidden=FALSE AND n.platform_limited=FALSE AND ` + visibleNoticeChapter + ` AND d.notice_id IN (` + strings.Join(marks, ",") + `) GROUP BY d.notice_id`
	rows, e = tx.QueryContext(ctx, q, noticeArgs...)
	if e != nil {
		return e
	}
	for rows.Next() {
		var raw []byte
		var count uint64
		if e = rows.Scan(&raw, &count); e != nil {
			rows.Close()
			return e
		}
		id, err := uuid.FromBytes(raw)
		if err != nil {
			rows.Close()
			return err
		}
		if i, ok := byNotice[id]; ok && items[i].Book != nil {
			items[i].ReadableChapters = count
		}
	}
	e = rows.Err()
	rows.Close()
	return e
}

type noticeCursor struct {
	ID      uuid.UUID
	Created time.Time
}

func (s Store) NovelNotices(ctx context.Context, reader uuid.UUID, token string) (NoticePage, error) {
	out := NoticePage{Items: []NovelNotice{}}
	if reader == uuid.Nil || len(token) > 512 {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	q := "SELECT " + noticeColumns + " FROM novel_notices WHERE account_id=?"
	args := []any{reader[:]}
	if token != "" {
		var c noticeCursor
		raw, err := base64.RawURLEncoding.DecodeString(token)
		if err != nil || json.Unmarshal(raw, &c) != nil || c.ID == uuid.Nil || c.Created.IsZero() {
			return out, ErrInvalid
		}
		var n int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_notices WHERE id=? AND account_id=? AND created_at=?", c.ID[:], reader[:], c.Created).Scan(&n); e != nil {
			return out, e
		}
		if n != 1 {
			return out, ErrInvalid
		}
		q += " AND (created_at<? OR(created_at=? AND id<?))"
		args = append(args, c.Created, c.Created, c.ID[:])
	}
	rows, e := tx.QueryContext(ctx, q+" ORDER BY created_at DESC,id DESC LIMIT 13", args...)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		v, err := scanNotice(rows)
		if err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	if len(out.Items) > 12 {
		out.Items = out.Items[:12]
		last := out.Items[11]
		raw, _ := json.Marshal(noticeCursor{last.ID, last.CreatedAt})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	if e = projectNotices(ctx, tx, out.Items); e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) NovelNoticeDetail(ctx context.Context, reader, id uuid.UUID, token string) (NoticeDetail, error) {
	out := NoticeDetail{Items: []DirectoryChapter{}}
	if reader == uuid.Nil || id == uuid.Nil || len(token) > 512 {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	n, e := scanNotice(tx.QueryRowContext(ctx, "SELECT "+noticeColumns+" FROM novel_notices WHERE id=? AND account_id=?", id[:], reader[:]))
	if e != nil {
		return out, e
	}
	one := []NovelNotice{n}
	if e = projectNotices(ctx, tx, one); e != nil {
		return out, e
	}
	out.Notice = one[0]
	q := `SELECT c.id,c.ordinal,(` + visibleNoticeChapter + `),CASE WHEN ` + visibleNoticeChapter + ` THEN v.title ELSE NULL END FROM novel_notice_deliveries d JOIN novel_chapters c ON c.id=d.chapter_id AND c.novel_id=d.novel_id JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.display_version WHERE d.notice_id=? AND d.account_id=?`
	args := []any{id[:], reader[:]}
	if token != "" {
		var c directoryCursor
		raw, err := base64.RawURLEncoding.DecodeString(token)
		if err != nil || json.Unmarshal(raw, &c) != nil || c.Book != n.NovelID || c.ID == uuid.Nil || c.Ordinal == 0 || c.Ordinal > maxRevision {
			return out, ErrInvalid
		}
		var found int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_notice_deliveries d JOIN novel_chapters c ON c.id=d.chapter_id WHERE d.notice_id=? AND d.account_id=? AND c.id=? AND c.ordinal=?", id[:], reader[:], c.ID[:], c.Ordinal).Scan(&found); e != nil {
			return out, e
		}
		if found != 1 {
			return out, ErrInvalid
		}
		q += " AND c.ordinal>?"
		args = append(args, c.Ordinal)
	}
	if out.Notice.Book == nil {
		return out, tx.Commit()
	}
	rows, e := tx.QueryContext(ctx, q+" ORDER BY c.ordinal LIMIT 51", args...)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var v DirectoryChapter
		var raw []byte
		if e = rows.Scan(&raw, &v.Ordinal, &v.Readable, &v.Title); e != nil {
			rows.Close()
			return out, e
		}
		v.ID, e = uuid.FromBytes(raw)
		if e != nil {
			rows.Close()
			return out, e
		}
		out.Items = append(out.Items, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	if len(out.Items) > 50 {
		out.Items = out.Items[:50]
		last := out.Items[49]
		raw, _ := json.Marshal(directoryCursor{n.NovelID, last.ID, last.Ordinal})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return out, tx.Commit()
}
func (s Store) ReadNovelNotice(ctx context.Context, reader, id uuid.UUID) (NoticeRead, error) {
	out := NoticeRead{ID: id}
	if reader == uuid.Nil || id == uuid.Nil {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "UPDATE novel_notices SET read_at=COALESCE(read_at,UTC_TIMESTAMP(6)) WHERE account_id=? AND id=?", reader[:], id[:]); e != nil {
		return out, e
	}
	e = tx.QueryRowContext(ctx, "SELECT read_at FROM novel_notices WHERE account_id=? AND id=?", reader[:], id[:]).Scan(&out.ReadAt)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
