package novel

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"time"
)

type PublicNovel struct {
	ID                       uuid.UUID `json:"id"`
	Title                    string    `json:"title"`
	Introduction             string    `json:"introduction"`
	Tags                     []string  `json:"tags"`
	Author                   string    `json:"author"`
	Completed                bool      `json:"completed"`
	ChapterCount             uint64    `json:"chapter_count"`
	FirstPublishedAt         time.Time `json:"first_published_at"`
	LatestChapterPublishedAt time.Time `json:"latest_chapter_published_at"`
}
type PublicNovelPage struct {
	Items      []PublicNovel `json:"items"`
	NextCursor string        `json:"next_cursor"`
}
type DirectoryChapter struct {
	ID       uuid.UUID `json:"id"`
	Ordinal  uint64    `json:"ordinal"`
	Readable bool      `json:"readable"`
	Title    *string   `json:"title"`
}
type DirectoryPage struct {
	Items      []DirectoryChapter `json:"items"`
	NextCursor string             `json:"next_cursor"`
}
type PublicNovelChapter struct {
	NovelID     uuid.UUID `json:"novel_id"`
	ChapterID   uuid.UUID `json:"chapter_id"`
	Ordinal     uint64    `json:"ordinal"`
	Title       string    `json:"title"`
	Content     string    `json:"content"`
	Version     uint64    `json:"version"`
	PublishedAt time.Time `json:"published_at"`
}

const readableNovel = `n.author_hidden=FALSE AND n.platform_limited=FALSE AND EXISTS(SELECT 1 FROM novel_chapters rc JOIN chapter_versions rv ON rv.chapter_id=rc.id AND rv.version=rc.display_version WHERE rc.novel_id=n.id AND rc.last_version>0 AND rc.author_hidden=FALSE AND rc.platform_limited=FALSE AND rv.platform_limited=FALSE)`
const publicNovelColumns = `p.novel_id,p.title,p.introduction,p.tags,a.nickname,(n.completed_at IS NOT NULL),(SELECT COUNT(*) FROM novel_chapters cc JOIN chapter_versions cv ON cv.chapter_id=cc.id AND cv.version=cc.display_version WHERE cc.novel_id=n.id AND cc.last_version>0),p.first_published_at,(SELECT MAX(fv.published_at) FROM chapter_versions fv WHERE fv.novel_id=n.id AND fv.version=1)`
const publicNovelJoin = ` FROM novels n JOIN novel_publications p ON p.novel_id=n.id AND p.owner_id=n.owner_id JOIN accounts a ON a.id=n.owner_id WHERE `

func scanPublicNovel(row interface{ Scan(...any) error }) (PublicNovel, error) {
	var out PublicNovel
	var id, tags []byte
	err := row.Scan(&id, &out.Title, &out.Introduction, &tags, &out.Author, &out.Completed, &out.ChapterCount, &out.FirstPublishedAt, &out.LatestChapterPublishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	out.ID, err = uuid.FromBytes(id)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(tags, &out.Tags)
	return out, err
}

type novelPublicCursor struct {
	ID   uuid.UUID
	Time time.Time
}

func (s Store) PublicNovels(ctx context.Context, token string) (PublicNovelPage, error) {
	out := PublicNovelPage{Items: []PublicNovel{}}
	if len(token) > 512 {
		return out, ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	q := "SELECT " + publicNovelColumns + publicNovelJoin + readableNovel
	args := []any{}
	if token != "" {
		raw, e := base64.RawURLEncoding.DecodeString(token)
		var c novelPublicCursor
		if e != nil || json.Unmarshal(raw, &c) != nil || c.ID == uuid.Nil || c.Time.IsZero() {
			return out, ErrInvalid
		}
		// The anchor can have become hidden since the previous page. Its immutable
		// first-release identity still anchors pagination without disclosing content.
		var n int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_publications WHERE novel_id=? AND first_published_at=?", c.ID[:], c.Time).Scan(&n); err != nil {
			return out, err
		}
		if n != 1 {
			return out, ErrInvalid
		}
		q += " AND (p.first_published_at<? OR (p.first_published_at=? AND p.novel_id<?))"
		args = append(args, c.Time, c.Time, c.ID[:])
	}
	rows, err := tx.QueryContext(ctx, q+" ORDER BY p.first_published_at DESC,p.novel_id DESC LIMIT 13", args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		item, e := scanPublicNovel(rows)
		if e != nil {
			rows.Close()
			return out, e
		}
		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if len(out.Items) > 12 {
		out.Items = out.Items[:12]
		last := out.Items[11]
		raw, _ := json.Marshal(novelPublicCursor{last.ID, last.FirstPublishedAt})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return out, tx.Commit()
}
func (s Store) PublicNovel(ctx context.Context, book uuid.UUID) (PublicNovel, error) {
	return scanPublicNovel(s.DB.QueryRowContext(ctx, "SELECT "+publicNovelColumns+publicNovelJoin+readableNovel+" AND n.id=?", book[:]))
}

type directoryCursor struct {
	Book, ID uuid.UUID
	Ordinal  uint64
}

func (s Store) Directory(ctx context.Context, book uuid.UUID, token string) (DirectoryPage, error) {
	out := DirectoryPage{Items: []DirectoryChapter{}}
	if len(token) > 512 {
		return out, ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var id []byte
	err = tx.QueryRowContext(ctx, "SELECT n.id"+publicNovelJoin+readableNovel+" AND n.id=?", book[:]).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	q := `SELECT c.id,c.ordinal,(c.author_hidden=FALSE AND c.platform_limited=FALSE AND v.platform_limited=FALSE),CASE WHEN c.author_hidden=FALSE AND c.platform_limited=FALSE AND v.platform_limited=FALSE THEN v.title ELSE NULL END FROM novel_chapters c JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.display_version WHERE c.novel_id=? AND c.last_version>0`
	args := []any{book[:]}
	if token != "" {
		raw, e := base64.RawURLEncoding.DecodeString(token)
		var c directoryCursor
		if e != nil || json.Unmarshal(raw, &c) != nil || c.Book != book || c.ID == uuid.Nil || c.Ordinal == 0 || c.Ordinal > maxRevision {
			return out, ErrInvalid
		}
		var n int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM novel_chapters c JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.display_version WHERE c.id=? AND c.novel_id=? AND c.ordinal=? AND c.last_version>0", c.ID[:], book[:], c.Ordinal).Scan(&n); err != nil {
			return out, err
		}
		if n != 1 {
			return out, ErrInvalid
		}
		q += " AND c.ordinal>?"
		args = append(args, c.Ordinal)
	}
	rows, err := tx.QueryContext(ctx, q+" ORDER BY c.ordinal LIMIT 51", args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item DirectoryChapter
		var raw []byte
		if err = rows.Scan(&raw, &item.Ordinal, &item.Readable, &item.Title); err != nil {
			rows.Close()
			return out, err
		}
		item.ID, err = uuid.FromBytes(raw)
		if err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	if len(out.Items) > 50 {
		out.Items = out.Items[:50]
		last := out.Items[49]
		raw, _ := json.Marshal(directoryCursor{book, last.ID, last.Ordinal})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return out, tx.Commit()
}
func (s Store) PublicChapter(ctx context.Context, book, chapter uuid.UUID) (PublicNovelChapter, error) {
	out := PublicNovelChapter{NovelID: book, ChapterID: chapter}
	err := s.DB.QueryRowContext(ctx, `SELECT c.ordinal,v.title,v.content,v.version,v.published_at FROM novel_chapters c JOIN novels n ON n.id=c.novel_id JOIN novel_publications p ON p.novel_id=n.id JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.display_version WHERE c.id=? AND c.novel_id=? AND c.last_version>0 AND n.author_hidden=FALSE AND n.platform_limited=FALSE AND c.author_hidden=FALSE AND c.platform_limited=FALSE AND v.platform_limited=FALSE`, chapter[:], book[:]).Scan(&out.Ordinal, &out.Title, &out.Content, &out.Version, &out.PublishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}
