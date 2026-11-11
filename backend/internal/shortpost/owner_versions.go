package shortpost

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type OwnerVersionNode struct {
	Version         uint64    `json:"version"`
	PublishedAt     time.Time `json:"published_at"`
	PlatformLimited bool      `json:"platform_limited"`
}

func (s PostStore) OwnerVersions(ctx context.Context, owner, post uuid.UUID, before uint64) ([]OwnerVersionNode, error) {
	query := `SELECT v.version,v.published_at,v.platform_limited
 FROM short_posts s LEFT JOIN short_post_versions v ON v.post_id=s.id AND v.owner_id=s.owner_id`
	var args []any
	if before > 0 {
		query += " AND v.version<?"
		args = append(args, before)
	}
	args = append(args, post[:], owner[:])
	rows, err := s.DB.QueryContext(ctx, query+" WHERE s.id=? AND s.owner_id=? ORDER BY v.version DESC LIMIT 20", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OwnerVersionNode{}
	exists := false
	for rows.Next() {
		exists = true
		var number sql.NullInt64
		var at sql.NullTime
		var limited sql.NullBool
		if err := rows.Scan(&number, &at, &limited); err != nil {
			return nil, err
		}
		if number.Valid {
			out = append(out, OwnerVersionNode{uint64(number.Int64), at.Time, limited.Bool})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !exists {
		return nil, sql.ErrNoRows
	}
	return out, nil
}
