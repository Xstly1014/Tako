package publication

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrFollowConflict = errors.New("follow_conflict")

// Each source selects only what a reader can open now. A book's update date
// comes from its readable chapters, including when its newest chapter is hidden.
type followSource struct{ kind, id, owner, title, updated, from, visible string }

const followedChapters = ` FROM novel_chapters c
 JOIN chapter_versions cv ON cv.chapter_id=c.id AND cv.version=c.display_version
 WHERE c.novel_id=n.id AND c.last_version>0 AND c.author_hidden=FALSE
 AND c.platform_limited=FALSE AND cv.platform_limited=FALSE`

var followSources = []followSource{
	{kind: "work", id: "w.id", owner: "w.owner_id", title: "v.title", updated: "v.published_at",
		from: discoveryFrom, visible: discoveryVisible},
	{kind: "novel", id: "n.id", owner: "n.owner_id", title: "p.title",
		updated: "(SELECT MAX(cv.published_at)" + followedChapters + ")",
		from: ` FROM novels n JOIN novel_publications p ON p.novel_id=n.id AND p.owner_id=n.owner_id
    JOIN accounts a ON a.id=n.owner_id `,
		visible: "n.author_hidden=FALSE AND n.platform_limited=FALSE AND EXISTS(SELECT 1" + followedChapters + ")"},
	{kind: "post", id: "s.id", owner: "s.owner_id", title: "p.title", updated: "v.published_at",
		from: ` FROM short_posts s JOIN short_post_versions v ON v.post_id=s.id AND v.version=s.display_version
    JOIN short_post_previews p ON p.owner_id=v.owner_id AND p.id=v.preview_id JOIN accounts a ON a.id=s.owner_id `,
		visible: `s.first_published_at IS NOT NULL AND s.author_hidden=FALSE AND s.platform_limited=FALSE AND v.platform_limited=FALSE`},
}

type FollowState struct {
	Following bool   `json:"following"`
	Own       bool   `json:"own"`
	Revision  uint64 `json:"revision"`
}
type FollowChange struct {
	Following        bool   `json:"following"`
	ExpectedRevision uint64 `json:"expected_revision"`
}

// A relation ID is accepted only inside the reader's own list. This lets a
// reader leave even after the author's last public work is withdrawn.
func (s Store) AuthorFollow(ctx context.Context, viewer uuid.UUID, kind string, target uuid.UUID, change *FollowChange) (FollowState, error) {
	var out FollowState
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: change == nil})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var nickname string
	if change != nil {
		if err = tx.QueryRowContext(ctx, "SELECT nickname FROM accounts WHERE id=? FOR UPDATE", viewer[:]).Scan(&nickname); err != nil {
			return out, err
		}
	}
	var owner uuid.UUID
	if kind == "relation" {
		err = tx.QueryRowContext(ctx, "SELECT author_id FROM author_follows WHERE reader_id=? AND id=?", viewer[:], target[:]).Scan(&owner)
	} else {
		err = ErrInvalid
		for _, source := range followSources {
			if kind == source.kind {
				err = tx.QueryRowContext(ctx, "SELECT "+source.owner+source.from+" WHERE "+source.id+"=? AND "+source.visible, target[:]).Scan(&owner)
				break
			}
		}
	}
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	out.Own = owner == viewer
	err = tx.QueryRowContext(ctx, "SELECT active,revision FROM author_follows WHERE reader_id=? AND author_id=?", viewer[:], owner[:]).Scan(&out.Following, &out.Revision)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}
	if change == nil {
		return out, tx.Commit()
	}
	if out.Own || (kind == "relation" && change.Following) {
		return out, ErrInvalid
	}
	if change.ExpectedRevision != out.Revision {
		return out, ErrFollowConflict
	}
	if change.Following != out.Following {
		if change.Following && nickname == "" {
			return out, ErrNickname
		}
		out.Following = change.Following
		out.Revision++
		edge := uuid.New()
		_, err = tx.ExecContext(ctx, `INSERT INTO author_follows(id,reader_id,author_id,active,revision,followed_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(6))
   ON DUPLICATE KEY UPDATE active=VALUES(active),revision=VALUES(revision),followed_at=IF(VALUES(active),VALUES(followed_at),followed_at)`, edge[:], viewer[:], owner[:], out.Following, out.Revision)
		if err != nil {
			return out, err
		}
	}
	return out, tx.Commit()
}

type followCursor struct {
	Scope string
	At    time.Time
	ID    uuid.UUID
	Kind  string
}

func followAfter(scope, token string) (followCursor, error) {
	var c followCursor
	if token == "" {
		return c, nil
	}
	if len(token) > 512 {
		return c, ErrInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || json.Unmarshal(raw, &c) != nil || c.Scope != scope || c.ID == uuid.Nil || c.At.IsZero() {
		return c, ErrInvalid
	}
	return c, nil
}
func (c followCursor) token() string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

type FollowPerson struct {
	ID       uuid.UUID `json:"id"`
	Nickname string    `json:"nickname"`
	Revision uint64    `json:"revision"`
	At       time.Time `json:"followed_at"`
}
type FollowPeoplePage struct {
	Total uint64         `json:"total"`
	Items []FollowPerson `json:"items"`
	Next  string         `json:"next_cursor"`
}

func (s Store) FollowPeople(ctx context.Context, viewer uuid.UUID, scope, token string) (FollowPeoplePage, error) {
	out := FollowPeoplePage{Items: []FollowPerson{}}
	c, err := followAfter(scope, token)
	if err != nil {
		return out, err
	}
	subject, person := "reader_id", "author_id"
	if scope == "followers" {
		subject, person = person, subject
	} else if scope != "following" {
		return out, ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM author_follows WHERE "+subject+"=? AND active=TRUE", viewer[:]).Scan(&out.Total); err != nil {
		return out, err
	}
	q := "SELECT f.id,a.nickname,f.revision,f.followed_at FROM author_follows f JOIN accounts a ON a.id=f." + person + " WHERE f." + subject + "=? AND f.active=TRUE"
	args := []any{viewer[:]}
	if token != "" {
		q += " AND (f.followed_at,f.id)<(?,?)"
		args = append(args, c.At, c.ID[:])
	}
	rows, err := tx.QueryContext(ctx, q+" ORDER BY f.followed_at DESC,f.id DESC LIMIT 21", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var p FollowPerson
		if err = rows.Scan(&p.ID, &p.Nickname, &p.Revision, &p.At); err != nil {
			return out, err
		}
		out.Items = append(out.Items, p)
	}
	if len(out.Items) > 20 {
		p := out.Items[19]
		out.Items = out.Items[:20]
		out.Next = followCursor{Scope: scope, At: p.At, ID: p.ID}.token()
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	return out, tx.Commit()
}

type FollowItem struct {
	Kind    string    `json:"kind"`
	ID      uuid.UUID `json:"id"`
	Title   string    `json:"title"`
	Author  string    `json:"author"`
	Updated time.Time `json:"updated_at"`
}
type FollowFeedPage struct {
	Items []FollowItem `json:"items"`
	Next  string       `json:"next_cursor"`
}

func (s Store) FollowingFeed(ctx context.Context, viewer uuid.UUID, token string, includePosts bool) (FollowFeedPage, error) {
	out := FollowFeedPage{Items: []FollowItem{}}
	c, err := followAfter("feed", token)
	if err != nil {
		return out, err
	}
	var parts []string
	var args []any
	for _, src := range followSources {
		if src.kind == "post" && !includePosts {
			continue
		}
		parts = append(parts, "SELECT '"+src.kind+"' AS kind,"+src.id+" AS id,"+src.title+" AS title,a.nickname AS author,"+src.updated+" AS updated_at"+src.from+" JOIN author_follows f ON f.author_id="+src.owner+" AND f.active=TRUE AND f.reader_id=? WHERE "+src.visible)
		args = append(args, viewer[:])
	}
	q := "SELECT kind,id,title,author,updated_at FROM (" + strings.Join(parts, " UNION ALL ") + ") feed"
	if token != "" {
		q += " WHERE (updated_at,kind,id)<(?,?,?)"
		args = append(args, c.At, c.Kind, c.ID[:])
	}
	rows, err := s.DB.QueryContext(ctx, q+" ORDER BY updated_at DESC,kind DESC,id DESC LIMIT 21", args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item FollowItem
		if err = rows.Scan(&item.Kind, &item.ID, &item.Title, &item.Author, &item.Updated); err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	if len(out.Items) > 20 {
		last := out.Items[19]
		out.Items = out.Items[:20]
		out.Next = followCursor{Scope: "feed", At: last.Updated, Kind: last.Kind, ID: last.ID}.token()
	}
	return out, rows.Err()
}
