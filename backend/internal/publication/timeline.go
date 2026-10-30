package publication

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

const pageSize = 20

type VersionEntry struct {
	Version     uint64    `json:"version"`
	PublishedAt time.Time `json:"published_at"`
	IsCurrent   bool      `json:"is_current"`
	Readable    bool      `json:"readable"`
}
type AuthorVersionEntry struct {
	Version         uint64    `json:"version"`
	Title           string    `json:"title"`
	PublishedAt     time.Time `json:"published_at"`
	PlatformLimited bool      `json:"platform_limited"`
	ReviewStatus    string    `json:"review_status"`
}
type Event struct {
	Sequence  uint64    `json:"sequence"`
	Kind      string    `json:"kind"`
	Version   uint64    `json:"version"`
	CreatedAt time.Time `json:"created_at"`
}
type PublicTimeline struct {
	HistoryOpen       bool           `json:"history_open"`
	Versions          []VersionEntry `json:"versions"`
	Events            []Event        `json:"events"`
	NextVersionBefore uint64         `json:"next_version_before"`
	NextEventBefore   uint64         `json:"next_event_before"`
}
type AuthorTimeline struct {
	State             State                `json:"state"`
	Versions          []AuthorVersionEntry `json:"versions"`
	Events            []Event              `json:"events"`
	NextVersionBefore uint64               `json:"next_version_before"`
	NextEventBefore   uint64               `json:"next_event_before"`
}

func validCursors(version, event uint64) bool { return version <= MaxSequence && event <= MaxSequence }
func events(ctx context.Context, tx *sql.Tx, id uuid.UUID, before uint64, public bool) ([]Event, uint64, error) {
	q := `SELECT e.sequence,e.kind,e.version,e.created_at FROM work_events e JOIN work_versions v ON v.work_id=e.work_id AND v.version=e.version WHERE e.work_id=? AND (?=0 OR e.sequence<?)`
	if public {
		q += " AND e.public_visible=TRUE AND v.platform_limited=FALSE"
	}
	q += " ORDER BY e.sequence DESC LIMIT 21"
	rows, e := tx.QueryContext(ctx, q, id[:], before, before)
	if e != nil {
		return nil, 0, e
	}
	defer rows.Close()
	out := make([]Event, 0)
	for rows.Next() {
		var event Event
		if e = rows.Scan(&event.Sequence, &event.Kind, &event.Version, &event.CreatedAt); e != nil {
			return nil, 0, e
		}
		out = append(out, event)
	}
	if e = rows.Err(); e != nil {
		return nil, 0, e
	}
	var next uint64
	if len(out) > pageSize {
		out = out[:pageSize]
		next = out[len(out)-1].Sequence
	}
	return out, next, nil
}
func (s Store) Timeline(ctx context.Context, id uuid.UUID, beforeVersion, beforeEvent uint64) (PublicTimeline, error) {
	out := PublicTimeline{Versions: []VersionEntry{}, Events: []Event{}}
	if !validCursors(beforeVersion, beforeEvent) {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	var display uint64
	e = tx.QueryRowContext(ctx, "SELECT history_open,display_version FROM works WHERE id=? AND author_hidden=FALSE AND platform_limited=FALSE", id[:]).Scan(&out.HistoryOpen, &display)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT version,published_at FROM work_versions WHERE work_id=? AND platform_limited=FALSE AND (?=0 OR version<?) ORDER BY version DESC LIMIT 21", id[:], beforeVersion, beforeVersion)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var v VersionEntry
		if e = rows.Scan(&v.Version, &v.PublishedAt); e != nil {
			rows.Close()
			return out, e
		}
		v.IsCurrent = v.Version == display
		v.Readable = out.HistoryOpen || v.IsCurrent
		out.Versions = append(out.Versions, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	if len(out.Versions) > pageSize {
		out.Versions = out.Versions[:pageSize]
		out.NextVersionBefore = out.Versions[len(out.Versions)-1].Version
	}
	out.Events, out.NextEventBefore, e = events(ctx, tx, id, beforeEvent, true)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s Store) AuthorTimeline(ctx context.Context, owner, id uuid.UUID, beforeVersion, beforeEvent uint64) (AuthorTimeline, error) {
	out := AuthorTimeline{Versions: []AuthorVersionEntry{}, Events: []Event{}}
	if !validCursors(beforeVersion, beforeEvent) {
		return out, ErrInvalid
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	out.State, e = scanState(tx.QueryRowContext(ctx, "SELECT "+stateFields+" FROM works WHERE id=? AND owner_id=?", id[:], owner[:]))
	if e != nil {
		return out, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT v.version,v.title,v.published_at,v.platform_limited,COALESCE(t.state,'pending') FROM work_versions v LEFT JOIN publication_review_tasks t ON t.work_id=v.work_id AND t.version=v.version WHERE v.work_id=? AND (?=0 OR v.version<?) ORDER BY v.version DESC LIMIT 21`, id[:], beforeVersion, beforeVersion)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var v AuthorVersionEntry
		if e = rows.Scan(&v.Version, &v.Title, &v.PublishedAt, &v.PlatformLimited, &v.ReviewStatus); e != nil {
			rows.Close()
			return out, e
		}
		out.Versions = append(out.Versions, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	if len(out.Versions) > pageSize {
		out.Versions = out.Versions[:pageSize]
		out.NextVersionBefore = out.Versions[len(out.Versions)-1].Version
	}
	out.Events, out.NextEventBefore, e = events(ctx, tx, id, beforeEvent, false)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}

type AuthorWorkSummary struct {
	ID              uuid.UUID `json:"id"`
	Title           string    `json:"title"`
	DraftID         uuid.UUID `json:"draft_id"`
	AuthorHidden    bool      `json:"author_hidden"`
	PlatformLimited bool      `json:"platform_limited"`
	DisplayVersion  uint64    `json:"display_version"`
	LastVersion     uint64    `json:"last_version"`
}
type AuthorWorkPage struct {
	Items      []AuthorWorkSummary `json:"items"`
	NextCursor string              `json:"next_cursor"`
}

func (s Store) AuthorWorks(ctx context.Context, owner uuid.UUID, cursor string) (AuthorWorkPage, error) {
	out := AuthorWorkPage{Items: []AuthorWorkSummary{}}
	args := []any{owner[:]}
	q := `SELECT w.id,v.title,w.source_draft_id,w.author_hidden,w.platform_limited,w.display_version,w.last_version FROM works w JOIN work_versions v ON v.work_id=w.id AND v.version=w.display_version WHERE w.owner_id=?`
	if cursor != "" {
		id, e := uuid.Parse(cursor)
		if e != nil {
			return out, ErrInvalid
		}
		var created time.Time
		e = s.DB.QueryRowContext(ctx, "SELECT created_at FROM works WHERE id=? AND owner_id=?", id[:], owner[:]).Scan(&created)
		if errors.Is(e, sql.ErrNoRows) {
			return out, ErrInvalid
		}
		if e != nil {
			return out, e
		}
		q += " AND (w.created_at<? OR (w.created_at=? AND w.id<?))"
		args = append(args, created, created, id[:])
	}
	q += " ORDER BY w.created_at DESC,w.id DESC LIMIT 21"
	rows, e := s.DB.QueryContext(ctx, q, args...)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var w AuthorWorkSummary
		var id, draft []byte
		if e = rows.Scan(&id, &w.Title, &draft, &w.AuthorHidden, &w.PlatformLimited, &w.DisplayVersion, &w.LastVersion); e != nil {
			return out, e
		}
		if w.ID, e = uuid.FromBytes(id); e != nil {
			return out, e
		}
		if w.DraftID, e = uuid.FromBytes(draft); e != nil {
			return out, e
		}
		out.Items = append(out.Items, w)
	}
	if e = rows.Err(); e != nil {
		return out, e
	}
	if len(out.Items) > pageSize {
		out.Items = out.Items[:pageSize]
		out.NextCursor = out.Items[len(out.Items)-1].ID.String()
	}
	return out, nil
}
