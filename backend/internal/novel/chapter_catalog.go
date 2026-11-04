package novel

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"github.com/google/uuid"
	"io"
	"strings"
	"time"
)

// Private management projection, never used for the public directory.
type ManagedChapter struct {
	ChapterState
	Title          string     `json:"title"`
	TitleSource    string     `json:"title_source"`
	PendingTitle   *string    `json:"pending_title"`
	DraftID        *uuid.UUID `json:"draft_id"`
	VersionLimited bool       `json:"version_limited"`
	CreatedAt      time.Time  `json:"created_at"`
}
type ManagedChapterPage struct {
	Items      []ManagedChapter `json:"items"`
	NextCursor string           `json:"next_cursor"`
}
type managedCursor struct {
	Domain          string
	Owner, Book, ID uuid.UUID
	Position        uint64
	Created         time.Time
}

const unassignedPosition uint64 = 9007199254740991

func (s Store) ManagedChapters(ctx context.Context, owner, book uuid.UUID, token string) (ManagedChapterPage, error) {
	out := ManagedChapterPage{Items: []ManagedChapter{}}
	if owner == uuid.Nil || book == uuid.Nil || len(token) > 512 {
		return out, ErrInvalid
	}
	var cursor managedCursor
	if token != "" {
		raw, e := base64.RawURLEncoding.DecodeString(token)
		if e != nil {
			return out, ErrInvalid
		}
		decoder := json.NewDecoder(strings.NewReader(string(raw)))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&cursor) != nil || decoder.Decode(&struct{}{}) != io.EOF || cursor.Domain != "novel-management-1" || cursor.Owner != owner || cursor.Book != book || cursor.ID == uuid.Nil || cursor.Position < 1 || cursor.Position > unassignedPosition || cursor.Created.IsZero() {
			return out, ErrInvalid
		}
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	parent, e := readNovelState(ctx, tx, owner, book)
	if e != nil {
		return out, e
	}
	query := `SELECT c.id,c.ordinal,c.state_revision,c.last_version,c.display_version,c.author_hidden,c.platform_limited,c.current_submission_id,
 COALESCE(v.title,JSON_UNQUOTE(JSON_EXTRACT(p.snapshot,'$.title')),d.title,''),CASE WHEN v.version IS NOT NULL THEN 'formal' WHEN p.id IS NOT NULL THEN 'pending' ELSE 'private' END,
 JSON_UNQUOTE(JSON_EXTRACT(p.snapshot,'$.title')),d.id,COALESCE(v.platform_limited,FALSE),c.created_at
 FROM novel_chapters c
 LEFT JOIN chapter_drafts d ON d.id=c.primary_draft_id AND d.chapter_id=c.id AND d.novel_id=c.novel_id AND d.owner_id=c.owner_id
 LEFT JOIN chapter_versions v ON v.chapter_id=c.id AND v.novel_id=c.novel_id AND v.owner_id=c.owner_id AND v.version=c.display_version
 LEFT JOIN chapter_submissions sub ON sub.id=c.current_submission_id AND sub.chapter_id=c.id AND sub.novel_id=c.novel_id AND sub.owner_id=c.owner_id AND sub.state='pending'
 LEFT JOIN chapter_previews p ON p.id=sub.preview_id AND p.chapter_id=c.id AND p.novel_id=c.novel_id AND p.owner_id=c.owner_id
 WHERE c.owner_id=? AND c.novel_id=?`
	args := []any{owner[:], book[:]}
	if token != "" {
		query += ` AND (COALESCE(c.ordinal,9007199254740991)>? OR (COALESCE(c.ordinal,9007199254740991)=? AND (c.created_at>? OR (c.created_at=? AND c.id>?))))`
		args = append(args, cursor.Position, cursor.Position, cursor.Created, cursor.Created, cursor.ID[:])
	}
	rows, e := tx.QueryContext(ctx, query+" ORDER BY COALESCE(c.ordinal,9007199254740991),c.created_at,c.id LIMIT 21", args...)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		item := ManagedChapter{ChapterState: ChapterState{NovelID: book, ParentHidden: parent.AuthorHidden, ParentLimited: parent.PlatformLimited, Completed: parent.Completed}}
		var chapter, draft, pending []byte
		var ordinal sql.NullInt64
		var pendingTitle sql.NullString
		if e = rows.Scan(&chapter, &ordinal, &item.StateRevision, &item.LastVersion, &item.DisplayVersion, &item.AuthorHidden, &item.PlatformLimited, &pending, &item.Title, &item.TitleSource, &pendingTitle, &draft, &item.VersionLimited, &item.CreatedAt); e != nil {
			rows.Close()
			return out, e
		}
		if item.ChapterID, e = uuid.FromBytes(chapter); e != nil {
			rows.Close()
			return out, e
		}
		if ordinal.Valid {
			value := uint64(ordinal.Int64)
			item.Ordinal = &value
		}
		if item.CurrentSubmissionID, e = nullableUUID(pending); e != nil {
			rows.Close()
			return out, e
		}
		if item.DraftID, e = nullableUUID(draft); e != nil {
			rows.Close()
			return out, e
		}
		if pendingTitle.Valid {
			value := pendingTitle.String
			item.PendingTitle = &value
		}
		out.Items = append(out.Items, item)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	if len(out.Items) > 20 {
		out.Items = out.Items[:20]
		last := out.Items[19]
		position := unassignedPosition
		if last.Ordinal != nil {
			position = *last.Ordinal
		}
		raw, _ := json.Marshal(managedCursor{"novel-management-1", owner, book, last.ChapterID, position, last.CreatedAt})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	if e = tx.Commit(); e != nil {
		return out, e
	}
	return out, nil
}
