package publication

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

type SearchPage struct {
	Items      []WorkCard `json:"items"`
	NextCursor string     `json:"next_cursor"`
}
type searchCursor struct {
	QueryHash string    `json:"query_hash"`
	At        time.Time `json:"at"`
	ID        uuid.UUID `json:"id"`
}

// Search only inspects currently public metadata. It never reads draft bodies,
// old versions, email addresses or comments, including when the caller owns them.
func (s Store) Search(ctx context.Context, query, cursor string) (SearchPage, error) {
	out := SearchPage{Items: []WorkCard{}}
	if !utf8.ValidString(query) || strings.IndexFunc(query, unicode.IsControl) >= 0 {
		return out, ErrInvalid
	}
	query = strings.ToLower(strings.TrimSpace(query))
	if utf8.RuneCountInString(query) < 1 || utf8.RuneCountInString(query) > 64 || len(cursor) > 512 {
		return out, ErrInvalid
	}
	hash := sha256.Sum256([]byte(query))
	queryHash := hex.EncodeToString(hash[:])
	var after searchCursor
	if cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil || json.Unmarshal(raw, &after) != nil || after.QueryHash != queryHash || after.At.IsZero() || after.ID == uuid.Nil {
			return out, ErrInvalid
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	// Explicit ESCAPE also makes backslashes literal regardless of SQL mode.
	pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(query) + "%"
	filter := " AND (LOWER(v.title) LIKE ? ESCAPE '!' OR LOWER(v.introduction) LIKE ? ESCAPE '!' OR LOWER(a.nickname) LIKE ? ESCAPE '!')"
	args := []any{pattern, pattern, pattern}
	if cursor != "" {
		filter += " AND (initial.published_at<? OR (initial.published_at=? AND w.id<?))"
		args = append(args, after.At, after.At, after.ID[:])
	}
	out.Items, err = readCards(ctx, tx, "SELECT "+cardColumns+discoveryFrom+" WHERE "+discoveryVisible+filter+" ORDER BY initial.published_at DESC,w.id DESC LIMIT 13", args...)
	if err != nil {
		return out, err
	}
	if len(out.Items) > 12 {
		last := out.Items[11]
		out.Items = out.Items[:12]
		raw, _ := json.Marshal(searchCursor{QueryHash: queryHash, At: last.FirstPublishedAt, ID: last.ID})
		out.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return out, tx.Commit()
}
