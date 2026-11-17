package shortpost

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

const reportEvidenceSource = ` FROM short_post_reports r
 JOIN short_posts s ON s.id=r.post_id
 JOIN short_post_versions v ON v.post_id=r.post_id AND v.version=r.version
 JOIN short_post_previews p ON p.owner_id=v.owner_id AND p.id=v.preview_id`

// Submitted formal snapshots remain protected evidence even when public access closes.
type ReportEvidence struct {
	AppealEvidence
	StateRevision       uint64  `json:"state_revision"`
	PostCaseRevision    *uint64 `json:"post_case_revision"`
	VersionCaseRevision *uint64 `json:"version_case_revision"`
}

func (s PostStore) ReportEvidence(ctx context.Context, id uint64) (ReportEvidence, error) {
	var out ReportEvidence
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	var owner, preview uuid.UUID
	e = tx.QueryRowContext(ctx, `SELECT p.owner_id,p.id,p.title,p.content,r.version,s.state_revision,
 IF(s.platform_limited,(SELECT MAX(state_revision) FROM short_post_actions WHERE post_id=s.id AND action='limit'),NULL),
 IF(v.platform_limited,(SELECT MAX(state_revision) FROM short_post_actions WHERE post_id=s.id AND action='limit_version' AND target_version=v.version),NULL)`+reportEvidenceSource+" WHERE r.id=?", id).Scan(&owner, &preview, &out.Title, &out.Content, &out.Version, &out.StateRevision, &out.PostCaseRevision, &out.VersionCaseRevision)
	if e != nil {
		return out, e
	}
	out.Images, e = previewImages(ctx, tx, owner, preview)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s PostStore) ReportEvidenceImage(ctx context.Context, id uint64, image uuid.UUID) (string, []byte, error) {
	var media string
	var body []byte
	e := s.DB.QueryRowContext(ctx, "SELECT i.media_type,i.content"+reportEvidenceSource+`
 JOIN short_post_preview_images m ON m.owner_id=p.owner_id AND m.preview_id=p.id
 JOIN short_post_images i ON i.owner_id=m.owner_id AND i.id=m.image_id
 WHERE r.id=? AND i.id=?`, id, image[:]).Scan(&media, &body)
	return media, body, e
}
