package publication

import (
	"context"
	"github.com/google/uuid"
)

type AuthorFeedbackEntry struct {
	Comment        Comment `json:"comment"`
	WorkTitle      string  `json:"work_title"`
	AwaitingAuthor bool    `json:"awaiting_author"`
}
type AuthorFeedbackPage struct {
	Items []AuthorFeedbackEntry `json:"items"`
	Next  uint64                `json:"next"`
}

const authorReplyMissing = `NOT EXISTS (SELECT 1 FROM work_comments reply WHERE reply.root_id=c.id AND reply.author_id=w.owner_id AND reply.deleted=FALSE AND reply.blocked=FALSE)`
const authorFeedbackFrom = commentJoins + ` JOIN works w ON w.id=c.work_id JOIN work_versions v ON v.work_id=w.id AND v.version=w.display_version `
const authorFeedbackWhere = ` WHERE w.owner_id=? AND ` + discoveryVisible + ` AND c.root_id IS NULL AND c.deleted=FALSE AND c.blocked=FALSE `

func (s Store) AuthorFeedback(ctx context.Context, owner uuid.UUID, awaiting bool, cursor uint64) (AuthorFeedbackPage, error) {
	out := AuthorFeedbackPage{Items: []AuthorFeedbackEntry{}}
	if owner == uuid.Nil || cursor > MaxSequence {
		return out, ErrInvalid
	}
	query := "SELECT " + commentColumns + ",v.title," + authorReplyMissing + authorFeedbackFrom + authorFeedbackWhere
	args := []any{owner[:]}
	if awaiting {
		query += " AND " + authorReplyMissing
	}
	if cursor > 0 {
		query += " AND c.sequence<?"
		args = append(args, cursor)
	}
	query += " ORDER BY c.sequence DESC LIMIT 21"
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry AuthorFeedbackEntry
		entry.Comment, err = scanComment(rows, &entry.WorkTitle, &entry.AwaitingAuthor)
		if err != nil {
			return out, err
		}
		if len(out.Items) == 20 {
			out.Next = out.Items[19].Comment.Sequence
			break
		}
		entry.Comment.CanDelete = true
		entry.Comment.Reason = ""
		out.Items = append(out.Items, entry)
	}
	return out, rows.Err()
}
func (s Store) AuthorFeedbackThread(ctx context.Context, owner, id uuid.UUID) (AuthorFeedbackEntry, error) {
	var out AuthorFeedbackEntry
	if owner == uuid.Nil || id == uuid.Nil {
		return out, ErrNotFound
	}
	row := s.DB.QueryRowContext(ctx, "SELECT "+commentColumns+",v.title,"+authorReplyMissing+authorFeedbackFrom+authorFeedbackWhere+" AND c.id=?", owner[:], id[:])
	var err error
	out.Comment, err = scanComment(row, &out.WorkTitle, &out.AwaitingAuthor)
	if err == nil {
		out.Comment.CanDelete = true
		out.Comment.Reason = ""
	}
	return out, err
}
