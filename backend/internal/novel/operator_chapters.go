package novel

import (
	"context"
	"github.com/google/uuid"
)

type OperatorChapter struct {
	ChapterID     uuid.UUID `json:"chapter_id"`
	Ordinal       uint64    `json:"ordinal"`
	Title         string    `json:"title"`
	Version       uint64    `json:"version"`
	StateRevision uint64    `json:"state_revision"`
}
type OperatorChapterPage struct {
	Items []OperatorChapter `json:"items"`
	Next  uint64            `json:"next"`
}

func (s Store) OperatorChapters(ctx context.Context, book uuid.UUID, after uint64) (OperatorChapterPage, error) {
	out := OperatorChapterPage{Items: []OperatorChapter{}}
	if book == uuid.Nil || after > maxRevision {
		return out, ErrInvalid
	}
	if _, e := s.formalOwner(ctx, book); e != nil {
		return out, e
	}
	rows, e := s.DB.QueryContext(ctx, `SELECT c.id,c.ordinal,v.title,c.last_version,c.state_revision FROM novel_chapters c JOIN chapter_versions v ON v.chapter_id=c.id AND v.version=c.last_version WHERE c.novel_id=? AND c.ordinal>? AND c.last_version>0 ORDER BY c.ordinal LIMIT 21`, book[:], after)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var c OperatorChapter
		var raw []byte
		if e = rows.Scan(&raw, &c.Ordinal, &c.Title, &c.Version, &c.StateRevision); e != nil {
			return out, e
		}
		c.ChapterID, e = uuid.FromBytes(raw)
		if e != nil {
			return out, e
		}
		out.Items = append(out.Items, c)
	}
	if e = rows.Err(); e != nil {
		return out, e
	}
	if len(out.Items) > 20 {
		out.Items = out.Items[:20]
		out.Next = out.Items[19].Ordinal
	}
	return out, nil
}
