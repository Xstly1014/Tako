package novel

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrCommentConflict = errors.New("comment_conflict")
var ErrCommentLimited = errors.New("comment_rate_limited")
var ErrCommentVersionUnavailable = errors.New("version_unavailable")

type ChapterComment struct {
	ID        uuid.UUID  `json:"id"`
	ChapterID uuid.UUID  `json:"chapter_id"`
	NovelID   uuid.UUID  `json:"novel_id"`
	AuthorID  uuid.UUID  `json:"author_id"`
	Nickname  string     `json:"nickname"`
	RootID    *uuid.UUID `json:"root_id"`
	ReplyTo   *uuid.UUID `json:"reply_to"`
	ReplyName string     `json:"reply_name"`
	Content   string     `json:"content"`
	Sequence  uint64     `json:"sequence"`
	Revision  uint64     `json:"revision"`
	Replies   uint64     `json:"replies"`
	CanDelete bool       `json:"can_delete"`
	CreatedAt time.Time  `json:"created_at"`
	Deleted   bool       `json:"deleted"`
	Blocked   bool       `json:"blocked"`
	Reason    string     `json:"reason"`
}
type ChapterCommentPage struct {
	Items []ChapterComment `json:"items"`
	Next  uint64           `json:"next"`
}
type ChapterCommentResult struct {
	ID       uuid.UUID `json:"id"`
	Revision uint64    `json:"revision"`
	State    string    `json:"state"`
}
type ChapterCommentCreate struct {
	MutationID        uuid.UUID  `json:"mutation_id"`
	ExpectedAccountID uuid.UUID  `json:"expected_account_id"`
	Content           string     `json:"content"`
	ReplyTo           *uuid.UUID `json:"reply_to"`
	Context           string     `json:"context"`
}
type ChapterCommentAction struct {
	MutationID        uuid.UUID `json:"mutation_id"`
	ExpectedAccountID uuid.UUID `json:"expected_account_id"`
	ExpectedRevision  uint64    `json:"expected_revision"`
	Action            string    `json:"action"`
	Reason            string    `json:"reason"`
}

const chapterCommentColumns = `c.id,c.chapter_id,c.novel_id,c.author_id,a.nickname,c.root_id,c.reply_to,
 IF(target.deleted=FALSE AND target.blocked=FALSE,ta.nickname,''),COALESCE(c.content,''),c.sequence,c.revision,c.created_at,c.deleted,c.blocked,
 (SELECT COUNT(*) FROM chapter_comments child WHERE child.root_id=c.id AND child.deleted=FALSE AND child.blocked=FALSE),
 COALESCE((SELECT reason FROM chapter_comment_actions act WHERE act.comment_id=c.id AND act.kind IN ('block','unblock') ORDER BY act.sequence DESC LIMIT 1),'')`
const chapterCommentJoins = ` FROM chapter_comments c JOIN accounts a ON a.id=c.author_id
 LEFT JOIN chapter_comments target ON target.id=c.reply_to LEFT JOIN accounts ta ON ta.id=target.author_id `

func scanChapterComment(row interface{ Scan(...any) error }, extra ...any) (ChapterComment, error) {
	var c ChapterComment
	var id, chapter, book, author, root, reply []byte
	fields := []any{&id, &chapter, &book, &author, &c.Nickname, &root, &reply, &c.ReplyName, &c.Content, &c.Sequence, &c.Revision, &c.CreatedAt, &c.Deleted, &c.Blocked, &c.Replies, &c.Reason}
	e := row.Scan(append(fields, extra...)...)
	if errors.Is(e, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	if e != nil {
		return c, e
	}
	c.ID = uuid.Must(uuid.FromBytes(id))
	c.ChapterID = uuid.Must(uuid.FromBytes(chapter))
	c.NovelID = uuid.Must(uuid.FromBytes(book))
	c.AuthorID = uuid.Must(uuid.FromBytes(author))
	if len(root) > 0 {
		x := uuid.Must(uuid.FromBytes(root))
		c.RootID = &x
	}
	if len(reply) > 0 {
		x := uuid.Must(uuid.FromBytes(reply))
		c.ReplyTo = &x
	}
	return c, nil
}

// Public roots use descending sequence, replies use ascending sequence. No comment stores a content version.
func (s Store) ChapterComments(ctx context.Context, book, chapter, root, viewer uuid.UUID, cursor uint64) (ChapterCommentPage, error) {
	out := ChapterCommentPage{Items: []ChapterComment{}}
	if cursor > maxRevision {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	var owner []byte
	e = tx.QueryRowContext(ctx, `SELECT n.owner_id FROM novels n JOIN novel_publications p ON p.novel_id=n.id JOIN novel_chapters ch ON ch.novel_id=n.id JOIN chapter_versions v ON v.chapter_id=ch.id AND v.version=ch.display_version WHERE n.id=? AND ch.id=? AND n.author_hidden=FALSE AND n.platform_limited=FALSE AND ch.last_version>0 AND ch.author_hidden=FALSE AND ch.platform_limited=FALSE AND v.platform_limited=FALSE`, book[:], chapter[:]).Scan(&owner)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	query := "SELECT " + chapterCommentColumns + chapterCommentJoins + " WHERE c.chapter_id=? AND c.deleted=FALSE AND c.blocked=FALSE"
	args := []any{chapter[:]}
	if root == uuid.Nil {
		query += " AND c.root_id IS NULL"
		if cursor > 0 {
			query += " AND c.sequence<?"
			args = append(args, cursor)
		}
		query += " ORDER BY c.sequence DESC"
	} else {
		var n int
		e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM chapter_comments WHERE id=? AND chapter_id=? AND root_id IS NULL AND deleted=FALSE AND blocked=FALSE", root[:], chapter[:]).Scan(&n)
		if e != nil {
			return out, e
		}
		if n != 1 {
			return out, ErrNotFound
		}
		query += " AND c.root_id=? AND c.sequence>? ORDER BY c.sequence ASC"
		args = append(args, root[:], cursor)
	}
	query += " LIMIT 21"
	rows, e := tx.QueryContext(ctx, query, args...)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		c, err := scanChapterComment(rows)
		if err != nil {
			rows.Close()
			return out, err
		}
		if len(out.Items) == 20 {
			out.Next = out.Items[19].Sequence
			break
		}
		c.Reason = ""
		c.CanDelete = viewer != uuid.Nil && (viewer == c.AuthorID || string(viewer[:]) == string(owner))
		out.Items = append(out.Items, c)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func chapterCommentReceipt(ctx context.Context, tx *sql.Tx, actor, mutation uuid.UUID, hash [32]byte) (ChapterCommentResult, bool, error) {
	var raw, old []byte
	var out ChapterCommentResult
	e := tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM chapter_comment_mutations WHERE actor_id=? AND mutation_id=?", actor[:], mutation[:]).Scan(&old, &raw)
	if errors.Is(e, sql.ErrNoRows) {
		return out, false, nil
	}
	if e != nil {
		return out, false, e
	}
	if string(old) != string(hash[:]) {
		return out, false, ErrKeyReuse
	}
	e = json.Unmarshal(raw, &out)
	return out, true, e
}
func saveChapterCommentReceipt(ctx context.Context, tx *sql.Tx, actor, mutation uuid.UUID, hash [32]byte, out ChapterCommentResult) error {
	raw, e := json.Marshal(out)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO chapter_comment_mutations(actor_id,mutation_id,payload_hash,result) VALUES(?,?,?,?)", actor[:], mutation[:], hash[:], raw)
	return e
}
func lockChapterCommentActor(ctx context.Context, tx *sql.Tx, actor uuid.UUID) (string, error) {
	var nick string
	e := tx.QueryRowContext(ctx, "SELECT nickname FROM accounts WHERE id=? FOR UPDATE", actor[:]).Scan(&nick)
	return nick, e
}

// version is ephemeral permission context verified by HTTP, never persisted as comment metadata.
func (s Store) CreateChapterComment(ctx context.Context, actor, book, chapter uuid.UUID, version uint64, in ChapterCommentCreate) (ChapterCommentResult, error) {
	var out ChapterCommentResult
	in.Content = strings.TrimSpace(in.Content)
	if in.MutationID == uuid.Nil || actor == uuid.Nil || book == uuid.Nil || chapter == uuid.Nil || in.ExpectedAccountID != actor || version == 0 || version > maxRevision || !utf8.ValidString(in.Content) || utf8.RuneCountInString(in.Content) < 1 || utf8.RuneCountInString(in.Content) > 1000 {
		return out, ErrInvalid
	}
	hash, e := chapterCommentDigest(struct {
		Book    uuid.UUID
		Chapter uuid.UUID
		Input   ChapterCommentCreate
	}{book, chapter, in})
	if e != nil {
		return out, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	nickname, e := lockChapterCommentActor(ctx, tx, actor)
	if e != nil {
		return out, e
	}
	if prior, found, e := chapterCommentReceipt(ctx, tx, actor, in.MutationID, hash); e != nil {
		return out, e
	} else if found {
		return prior, tx.Commit()
	}
	if strings.TrimSpace(nickname) == "" {
		return out, ErrNickname
	}
	var hidden, limited bool
	e = tx.QueryRowContext(ctx, "SELECT author_hidden,platform_limited FROM novels WHERE id=? FOR UPDATE", book[:]).Scan(&hidden, &limited)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	if hidden || limited {
		return out, ErrNotFound
	}
	var currentLimited bool
	e = tx.QueryRowContext(ctx, `SELECT c.author_hidden,c.platform_limited,v.platform_limited FROM novel_chapters c JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.display_version WHERE c.id=? AND c.novel_id=? AND c.last_version>0 FOR UPDATE`, chapter[:], book[:]).Scan(&hidden, &limited, &currentLimited)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	if hidden || limited || currentLimited {
		return out, ErrNotFound
	}
	var versionLimited bool
	e = tx.QueryRowContext(ctx, "SELECT platform_limited FROM chapter_versions WHERE chapter_id=? AND novel_id=? AND version=?", chapter[:], book[:], version).Scan(&versionLimited)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	if versionLimited {
		return out, ErrCommentVersionUnavailable
	}
	var rootArg, replyArg any
	if in.ReplyTo != nil {
		if *in.ReplyTo == uuid.Nil {
			return out, ErrInvalid
		}
		var root []byte
		var deleted, blocked bool
		e = tx.QueryRowContext(ctx, "SELECT root_id,deleted,blocked FROM chapter_comments WHERE id=? AND chapter_id=? FOR UPDATE", in.ReplyTo[:], chapter[:]).Scan(&root, &deleted, &blocked)
		if errors.Is(e, sql.ErrNoRows) {
			return out, ErrNotFound
		}
		if e != nil {
			return out, e
		}
		if deleted || blocked {
			return out, ErrCommentConflict
		}
		if len(root) == 0 {
			root = in.ReplyTo[:]
		}
		e = tx.QueryRowContext(ctx, "SELECT deleted,blocked FROM chapter_comments WHERE id=? FOR UPDATE", root).Scan(&deleted, &blocked)
		if e != nil {
			return out, e
		}
		if deleted || blocked {
			return out, ErrCommentConflict
		}
		rootArg = root
		replyArg = in.ReplyTo[:]
	}
	var recent int
	e = tx.QueryRowContext(ctx, "SELECT (SELECT COUNT(*) FROM chapter_comments WHERE author_id=? AND created_at>UTC_TIMESTAMP(6)-INTERVAL 1 MINUTE)+(SELECT COUNT(*) FROM work_comments WHERE author_id=? AND created_at>UTC_TIMESTAMP(6)-INTERVAL 1 MINUTE)", actor[:], actor[:]).Scan(&recent)
	if e != nil {
		return out, e
	}
	if recent >= 5 {
		return out, ErrCommentLimited
	}
	out = ChapterCommentResult{ID: uuid.New(), Revision: 1, State: "published"}
	_, e = tx.ExecContext(ctx, "INSERT INTO chapter_comments(id,chapter_id,novel_id,author_id,root_id,reply_to,content,created_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(6))", out.ID[:], chapter[:], book[:], actor[:], rootArg, replyArg, in.Content)
	if e != nil {
		return out, e
	}
	if e = saveChapterCommentReceipt(ctx, tx, actor, in.MutationID, hash, out); e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) ActOnChapterComment(ctx context.Context, actor, id uuid.UUID, operator bool, in ChapterCommentAction) (ChapterCommentResult, error) {
	out := ChapterCommentResult{ID: id}
	in.Reason = strings.TrimSpace(in.Reason)
	if actor == uuid.Nil || id == uuid.Nil || in.MutationID == uuid.Nil || in.ExpectedAccountID != actor || in.ExpectedRevision == 0 || in.ExpectedRevision >= maxRevision {
		return out, ErrInvalid
	}
	if in.Action != "delete" && in.Action != "block" && in.Action != "unblock" {
		return out, ErrInvalid
	}
	if in.Action != "delete" && (!operator || !utf8.ValidString(in.Reason) || utf8.RuneCountInString(in.Reason) < 1 || utf8.RuneCountInString(in.Reason) > 500) {
		return out, ErrInvalid
	}
	hash, e := chapterCommentDigest(struct {
		ID    uuid.UUID
		Input ChapterCommentAction
	}{id, in})
	if e != nil {
		return out, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if _, e = lockChapterCommentActor(ctx, tx, actor); e != nil {
		return out, e
	}
	if prior, found, e := chapterCommentReceipt(ctx, tx, actor, in.MutationID, hash); e != nil {
		return out, e
	} else if found {
		return prior, tx.Commit()
	}
	var chapter []byte
	e = tx.QueryRowContext(ctx, "SELECT chapter_id FROM chapter_comments WHERE id=?", id[:]).Scan(&chapter)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	var owner, book []byte
	// Resolve immutable membership without a join lock; then lock only the book.
	// A locking join may let the optimizer acquire chapter before book.
	e = tx.QueryRowContext(ctx, "SELECT novel_id FROM novel_chapters WHERE id=?", chapter).Scan(&book)
	if e != nil {
		return out, e
	}
	e = tx.QueryRowContext(ctx, "SELECT owner_id FROM novels WHERE id=? FOR UPDATE", book).Scan(&owner)
	if e != nil {
		return out, e
	}
	var author, root []byte
	var deleted, blocked bool
	var revision uint64
	e = tx.QueryRowContext(ctx, "SELECT author_id,root_id,deleted,blocked,revision FROM chapter_comments WHERE id=? FOR UPDATE", id[:]).Scan(&author, &root, &deleted, &blocked, &revision)
	if e != nil {
		return out, e
	}
	if in.Action == "delete" && string(actor[:]) != string(author) && string(actor[:]) != string(owner) {
		return out, ErrNotFound
	}
	if !deleted && revision != in.ExpectedRevision {
		return out, ErrCommentConflict
	}
	if deleted {
		out.Revision = revision
		out.State = "deleted"
	} else {
		switch in.Action {
		case "delete":
			q := "UPDATE chapter_comments SET deleted=TRUE,content=NULL,revision=revision+1 WHERE deleted=FALSE AND id=?"
			args := []any{id[:]}
			if len(root) == 0 {
				q += " OR (deleted=FALSE AND root_id=?)"
				args = append(args, id[:])
			}
			_, e = tx.ExecContext(ctx, q, args...)
			out.State = "deleted"
		case "block":
			_, e = tx.ExecContext(ctx, "UPDATE chapter_comments SET blocked=TRUE,revision=revision+1 WHERE id=?", id[:])
			out.State = "blocked"
		case "unblock":
			_, e = tx.ExecContext(ctx, "UPDATE chapter_comments SET blocked=FALSE,revision=revision+1 WHERE id=?", id[:])
			out.State = "published"
		}
		if e != nil {
			return out, e
		}
		out.Revision = revision + 1
		_, e = tx.ExecContext(ctx, "INSERT INTO chapter_comment_actions(comment_id,actor_id,kind,reason,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP(6))", id[:], actor[:], in.Action, in.Reason)
		if e != nil {
			return out, e
		}
	}
	if e = saveChapterCommentReceipt(ctx, tx, actor, in.MutationID, hash, out); e != nil {
		return out, e
	}
	return out, tx.Commit()
}

// Private/ops list intentionally contains no chapter title or historical body.
func (s Store) ManagedChapterComments(ctx context.Context, actor uuid.UUID, operator bool, before uint64) (ChapterCommentPage, error) {
	return s.managedChapterComments(ctx, actor, uuid.Nil, operator, before)
}
func (s Store) ChapterCommentsForAuthor(ctx context.Context, actor, book uuid.UUID, before uint64) (ChapterCommentPage, error) {
	if book == uuid.Nil || actor == uuid.Nil {
		return ChapterCommentPage{}, ErrInvalid
	}
	var found int
	if e := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM novels WHERE id=? AND owner_id=?", book[:], actor[:]).Scan(&found); e != nil {
		return ChapterCommentPage{}, e
	}
	if found != 1 {
		return ChapterCommentPage{}, ErrNotFound
	}
	return s.managedChapterComments(ctx, actor, book, false, before)
}
func (s Store) managedChapterComments(ctx context.Context, actor, book uuid.UUID, operator bool, before uint64) (ChapterCommentPage, error) {
	out := ChapterCommentPage{Items: []ChapterComment{}}
	if before > maxRevision {
		return out, ErrInvalid
	}
	q := "SELECT " + chapterCommentColumns + chapterCommentJoins + " WHERE 1=1"
	args := []any{}
	if book != uuid.Nil {
		q += " AND c.novel_id=?"
		args = append(args, book[:])
	} else if !operator {
		q += " AND c.author_id=?"
		args = append(args, actor[:])
	}
	if before > 0 {
		q += " AND c.sequence<?"
		args = append(args, before)
	}
	q += " ORDER BY c.sequence DESC LIMIT 21"
	rows, e := s.DB.QueryContext(ctx, q, args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		c, e := scanChapterComment(rows)
		if e != nil {
			return out, e
		}
		if len(out.Items) == 20 {
			out.Next = out.Items[19].Sequence
			break
		}
		c.CanDelete = c.AuthorID == actor || book != uuid.Nil
		if !operator {
			c.ReplyName = ""
			if c.AuthorID != actor {
				c.Reason = ""
			}
		}
		out.Items = append(out.Items, c)
	}
	return out, rows.Err()
}

func chapterCommentDigest(v any) ([32]byte, error) {
	b, e := json.Marshal(v)
	return sha256.Sum256(b), e
}
