package publication

import (
	"context"
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

type Comment struct {
	ID        uuid.UUID  `json:"id"`
	WorkID    uuid.UUID  `json:"work_id"`
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
type CommentPage struct {
	Items []Comment `json:"items"`
	Next  uint64    `json:"next"`
}
type CommentResult struct {
	ID       uuid.UUID `json:"id"`
	Revision uint64    `json:"revision"`
	State    string    `json:"state"`
}
type CommentCreate struct {
	MutationID        uuid.UUID  `json:"mutation_id"`
	ExpectedAccountID uuid.UUID  `json:"expected_account_id"`
	Content           string     `json:"content"`
	ReplyTo           *uuid.UUID `json:"reply_to"`
	Context           string     `json:"context"`
}
type CommentAction struct {
	MutationID        uuid.UUID `json:"mutation_id"`
	ExpectedAccountID uuid.UUID `json:"expected_account_id"`
	ExpectedRevision  uint64    `json:"expected_revision"`
	Action            string    `json:"action"`
	Reason            string    `json:"reason"`
}

const commentColumns = `c.id,c.work_id,c.author_id,a.nickname,c.root_id,c.reply_to,
 IF(target.deleted=FALSE AND target.blocked=FALSE,ta.nickname,''),COALESCE(c.content,''),c.sequence,c.revision,c.created_at,c.deleted,c.blocked,
 (SELECT COUNT(*) FROM work_comments child WHERE child.root_id=c.id AND child.deleted=FALSE AND child.blocked=FALSE),
 COALESCE((SELECT reason FROM comment_actions act WHERE act.comment_id=c.id AND act.kind IN ('block','unblock') ORDER BY act.sequence DESC LIMIT 1),'')`
const commentJoins = ` FROM work_comments c JOIN accounts a ON a.id=c.author_id
 LEFT JOIN work_comments target ON target.id=c.reply_to LEFT JOIN accounts ta ON ta.id=target.author_id `

func scanComment(row interface{ Scan(...any) error }) (Comment, error) {
	var c Comment
	var id, work, author, root, reply []byte
	e := row.Scan(&id, &work, &author, &c.Nickname, &root, &reply, &c.ReplyName, &c.Content, &c.Sequence, &c.Revision, &c.CreatedAt, &c.Deleted, &c.Blocked, &c.Replies, &c.Reason)
	if errors.Is(e, sql.ErrNoRows) {
		return c, ErrNotFound
	}
	if e != nil {
		return c, e
	}
	c.ID = uuid.Must(uuid.FromBytes(id))
	c.WorkID = uuid.Must(uuid.FromBytes(work))
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
func (s Store) Comments(ctx context.Context, work, root, viewer uuid.UUID, cursor uint64) (CommentPage, error) {
	out := CommentPage{Items: []Comment{}}
	if cursor > MaxSequence {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	var owner []byte
	e = tx.QueryRowContext(ctx, `SELECT w.owner_id FROM works w JOIN work_versions v ON v.work_id=w.id AND v.version=w.display_version WHERE w.id=? AND `+discoveryVisible, work[:]).Scan(&owner)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	query := "SELECT " + commentColumns + commentJoins + " WHERE c.work_id=? AND c.deleted=FALSE AND c.blocked=FALSE"
	args := []any{work[:]}
	if root == uuid.Nil {
		query += " AND c.root_id IS NULL"
		if cursor > 0 {
			query += " AND c.sequence<?"
			args = append(args, cursor)
		}
		query += " ORDER BY c.sequence DESC"
	} else {
		var n int
		e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM work_comments WHERE id=? AND work_id=? AND root_id IS NULL AND deleted=FALSE AND blocked=FALSE", root[:], work[:]).Scan(&n)
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
		c, err := scanComment(rows)
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
func commentReceipt(ctx context.Context, tx *sql.Tx, actor, mutation uuid.UUID, hash [32]byte) (CommentResult, bool, error) {
	var raw, old []byte
	var out CommentResult
	e := tx.QueryRowContext(ctx, "SELECT payload_hash,result FROM comment_mutations WHERE actor_id=? AND mutation_id=?", actor[:], mutation[:]).Scan(&old, &raw)
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
func saveCommentReceipt(ctx context.Context, tx *sql.Tx, actor, mutation uuid.UUID, hash [32]byte, out CommentResult) error {
	raw, e := json.Marshal(out)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO comment_mutations(actor_id,mutation_id,payload_hash,result) VALUES(?,?,?,?)", actor[:], mutation[:], hash[:], raw)
	return e
}
func lockCommentActor(ctx context.Context, tx *sql.Tx, actor uuid.UUID) (string, error) {
	var nick string
	e := tx.QueryRowContext(ctx, "SELECT nickname FROM accounts WHERE id=? FOR UPDATE", actor[:]).Scan(&nick)
	return nick, e
}

// version is ephemeral permission context verified by HTTP, never persisted as comment metadata.
func (s Store) CreateComment(ctx context.Context, actor, work uuid.UUID, version uint64, in CommentCreate) (CommentResult, error) {
	var out CommentResult
	in.Content = strings.TrimSpace(in.Content)
	if in.MutationID == uuid.Nil || actor == uuid.Nil || work == uuid.Nil || in.ExpectedAccountID != actor || version == 0 || version > MaxSequence || !utf8.ValidString(in.Content) || utf8.RuneCountInString(in.Content) < 1 || utf8.RuneCountInString(in.Content) > 1000 {
		return out, ErrInvalid
	}
	hash, e := digest(struct {
		Work  uuid.UUID
		Input CommentCreate
	}{work, in})
	if e != nil {
		return out, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	nickname, e := lockCommentActor(ctx, tx, actor)
	if e != nil {
		return out, e
	}
	if prior, found, e := commentReceipt(ctx, tx, actor, in.MutationID, hash); e != nil {
		return out, e
	} else if found {
		return prior, tx.Commit()
	}
	if strings.TrimSpace(nickname) == "" {
		return out, ErrNickname
	}
	var hidden, limited bool
	e = tx.QueryRowContext(ctx, "SELECT author_hidden,platform_limited FROM works WHERE id=? FOR UPDATE", work[:]).Scan(&hidden, &limited)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	if hidden || limited {
		return out, ErrNotFound
	}
	var versionLimited bool
	e = tx.QueryRowContext(ctx, "SELECT platform_limited FROM work_versions WHERE work_id=? AND version=?", work[:], version).Scan(&versionLimited)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	if versionLimited {
		return out, ErrVersionUnavailable
	}
	var rootArg, replyArg any
	if in.ReplyTo != nil {
		if *in.ReplyTo == uuid.Nil {
			return out, ErrInvalid
		}
		var root []byte
		var deleted, blocked bool
		e = tx.QueryRowContext(ctx, "SELECT root_id,deleted,blocked FROM work_comments WHERE id=? AND work_id=? FOR UPDATE", in.ReplyTo[:], work[:]).Scan(&root, &deleted, &blocked)
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
		e = tx.QueryRowContext(ctx, "SELECT deleted,blocked FROM work_comments WHERE id=? FOR UPDATE", root).Scan(&deleted, &blocked)
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
	e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM work_comments WHERE author_id=? AND created_at>UTC_TIMESTAMP(6)-INTERVAL 1 MINUTE", actor[:]).Scan(&recent)
	if e != nil {
		return out, e
	}
	if recent >= 5 {
		return out, ErrCommentLimited
	}
	out = CommentResult{ID: uuid.New(), Revision: 1, State: "published"}
	_, e = tx.ExecContext(ctx, "INSERT INTO work_comments(id,work_id,author_id,root_id,reply_to,content,created_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(6))", out.ID[:], work[:], actor[:], rootArg, replyArg, in.Content)
	if e != nil {
		return out, e
	}
	if e = saveCommentReceipt(ctx, tx, actor, in.MutationID, hash, out); e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) ActOnComment(ctx context.Context, actor, id uuid.UUID, operator bool, in CommentAction) (CommentResult, error) {
	out := CommentResult{ID: id}
	in.Reason = strings.TrimSpace(in.Reason)
	if actor == uuid.Nil || id == uuid.Nil || in.MutationID == uuid.Nil || in.ExpectedAccountID != actor || in.ExpectedRevision == 0 || in.ExpectedRevision >= MaxSequence {
		return out, ErrInvalid
	}
	if in.Action != "delete" && in.Action != "block" && in.Action != "unblock" {
		return out, ErrInvalid
	}
	if in.Action != "delete" && (!operator || !utf8.ValidString(in.Reason) || utf8.RuneCountInString(in.Reason) < 1 || utf8.RuneCountInString(in.Reason) > 500) {
		return out, ErrInvalid
	}
	hash, e := digest(struct {
		ID    uuid.UUID
		Input CommentAction
	}{id, in})
	if e != nil {
		return out, e
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if _, e = lockCommentActor(ctx, tx, actor); e != nil {
		return out, e
	}
	if prior, found, e := commentReceipt(ctx, tx, actor, in.MutationID, hash); e != nil {
		return out, e
	} else if found {
		return prior, tx.Commit()
	}
	var work []byte
	e = tx.QueryRowContext(ctx, "SELECT work_id FROM work_comments WHERE id=?", id[:]).Scan(&work)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	var owner []byte
	e = tx.QueryRowContext(ctx, "SELECT owner_id FROM works WHERE id=? FOR UPDATE", work).Scan(&owner)
	if e != nil {
		return out, e
	}
	var author, root []byte
	var deleted, blocked bool
	var revision uint64
	e = tx.QueryRowContext(ctx, "SELECT author_id,root_id,deleted,blocked,revision FROM work_comments WHERE id=? FOR UPDATE", id[:]).Scan(&author, &root, &deleted, &blocked, &revision)
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
			q := "UPDATE work_comments SET deleted=TRUE,content=NULL,revision=revision+1 WHERE deleted=FALSE AND id=?"
			args := []any{id[:]}
			if len(root) == 0 {
				q += " OR (deleted=FALSE AND root_id=?)"
				args = append(args, id[:])
			}
			_, e = tx.ExecContext(ctx, q, args...)
			out.State = "deleted"
		case "block":
			_, e = tx.ExecContext(ctx, "UPDATE work_comments SET blocked=TRUE,revision=revision+1 WHERE id=?", id[:])
			out.State = "blocked"
		case "unblock":
			_, e = tx.ExecContext(ctx, "UPDATE work_comments SET blocked=FALSE,revision=revision+1 WHERE id=?", id[:])
			out.State = "published"
		}
		if e != nil {
			return out, e
		}
		out.Revision = revision + 1
		_, e = tx.ExecContext(ctx, "INSERT INTO comment_actions(comment_id,actor_id,kind,reason,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP(6))", id[:], actor[:], in.Action, in.Reason)
		if e != nil {
			return out, e
		}
	}
	if e = saveCommentReceipt(ctx, tx, actor, in.MutationID, hash, out); e != nil {
		return out, e
	}
	return out, tx.Commit()
}

// Private/ops list intentionally contains no work title or historical body.
func (s Store) ManagedComments(ctx context.Context, actor uuid.UUID, operator bool, before uint64) (CommentPage, error) {
	out := CommentPage{Items: []Comment{}}
	if before > MaxSequence {
		return out, ErrInvalid
	}
	q := "SELECT " + commentColumns + commentJoins + " WHERE 1=1"
	args := []any{}
	if !operator {
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
		c, e := scanComment(rows)
		if e != nil {
			return out, e
		}
		if len(out.Items) == 20 {
			out.Next = out.Items[19].Sequence
			break
		}
		c.CanDelete = c.AuthorID == actor
		if !operator {
			c.ReplyName = ""
		}
		out.Items = append(out.Items, c)
	}
	return out, rows.Err()
}
