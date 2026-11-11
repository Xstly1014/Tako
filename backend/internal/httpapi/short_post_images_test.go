package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/shortpost"
)

func TestShortPostImageStaging(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("real MySQL required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	tokens := make([]string, 2)
	owners := make([]uuid.UUID, len(tokens))
	for i := range tokens {
		id := uuid.New()
		owners[i] = id
		if _, err := db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", id[:], id.String()+"@example.test", "图片合成作者"); err != nil {
			t.Fatal(err)
		}
		defer func() {
			for _, query := range []string{"DELETE FROM short_post_versions WHERE owner_id=?", "DELETE FROM short_posts WHERE owner_id=?", "DELETE FROM short_post_preview_images WHERE owner_id=?", "DELETE FROM short_post_previews WHERE owner_id=?", "DELETE FROM short_post_images WHERE owner_id=?", "DELETE FROM sessions WHERE account_id=?", "DELETE FROM accounts WHERE id=?"} {
				if _, err := db.Exec(query, id[:]); err != nil {
					t.Errorf("fixture cleanup: %v", err)
				}
			}
		}()
		tokens[i] = strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
		if err := insertLegacySession(ctx, db, id, tokens[i]); err != nil {
			t.Fatal(err)
		}
	}
	const origin = "http://localhost:3000"
	router := gin.New()
	api := API{DB: db, Identity: &identity.Service{DB: db}, Origin: origin, EnablePublications: true, EnvironmentName: "test"}
	if err := api.Register(router); err != nil {
		t.Fatal(err)
	}
	send := func(method string, id uuid.UUID, token, source, mediaType string, body []byte) (*http.Request, *httptest.ResponseRecorder) {
		req := httptest.NewRequest(method, "/api/my/short-post-images/"+id.String(), bytes.NewReader(body))
		if token != "" {
			req.AddCookie(&http.Cookie{Name: api.sessionCookieName(), Value: token})
		}
		req.Header.Set("Origin", source)
		req.Header.Set("Content-Type", mediaType)
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return req, out
	}
	call := func(method string, id uuid.UUID, token, source, mediaType string, body []byte, want int) *httptest.ResponseRecorder {
		t.Helper()
		req, out := send(method, id, token, source, mediaType, body)
		validateResponse(t, req, out)
		if out.Code != want {
			t.Fatalf("%s returned %d want %d", method, out.Code, want)
		}
		return out
	}
	var sample bytes.Buffer
	if err := png.Encode(&sample, image.NewRGBA(image.Rect(0, 0, 3, 2))); err != nil {
		t.Fatal(err)
	}
	pngBody := sample.Bytes()
	extra := []byte("synthetic trailing data must not be stored")
	original := append(bytes.Clone(pngBody), extra...)
	id := uuid.New()
	call("PUT", id, "", origin, "image/png", original, 401)
	call("PUT", id, tokens[0], "https://untrusted.example.test", "image/png", original, 403)
	call("PUT", id, tokens[0], origin, "application/json", original, 415)
	call("PUT", id, tokens[0], origin, "image/jpeg", original, 400)
	call("PUT", id, tokens[0], origin, "image/png", pngBody[:len(pngBody)/2], 400)
	call("PUT", id, tokens[0], origin, "image/png", make([]byte, shortpost.MaxImageBytes+1), 413)
	oversized := bytes.Clone(pngBody)
	binary.BigEndian.PutUint32(oversized[16:20], 4001)
	binary.BigEndian.PutUint32(oversized[20:24], 3000)
	binary.BigEndian.PutUint32(oversized[29:33], crc32.ChecksumIEEE(oversized[12:29]))
	call("PUT", id, tokens[0], origin, "image/png", oversized, 413)
	first := call("PUT", id, tokens[0], origin, "image/png", original, 200)
	again := call("PUT", id, tokens[0], origin, "image/png", original, 200)
	if !bytes.Equal(first.Body.Bytes(), again.Body.Bytes()) {
		t.Fatal("upload receipt changed on retry")
	}
	call("PUT", id, tokens[0], origin, "image/png", pngBody, 409)
	call("GET", id, tokens[1], "", "", nil, 404)
	call("GET", id, "", "", "", nil, 401)
	read := call("GET", id, tokens[0], "", "", nil, 200)
	if bytes.Contains(read.Body.Bytes(), extra) || read.Header().Get("Cache-Control") != "no-store" || read.Header().Get("Content-Type") != "image/png" {
		t.Fatal("private response included original trailing data or incorrect headers")
	}
	if conf, err := png.DecodeConfig(read.Body); err != nil || conf.Width != 3 || conf.Height != 2 {
		t.Fatal("sanitized image is not decodable")
	}
	var jpegSample bytes.Buffer
	if err := jpeg.Encode(&jpegSample, image.NewRGBA(image.Rect(0, 0, 2, 3)), nil); err != nil {
		t.Fatal(err)
	}
	jpegID := uuid.New()
	call("PUT", jpegID, tokens[1], origin, "image/jpeg", jpegSample.Bytes(), 200)
	jpegRead := call("GET", jpegID, tokens[1], "", "", nil, 200)
	if _, err := jpeg.Decode(jpegRead.Body); err != nil {
		t.Fatal("sanitized JPEG is not decodable")
	}
	for i := 1; i < 15; i++ {
		call("PUT", uuid.New(), tokens[0], origin, "image/png", pngBody, 200)
	}
	type result struct {
		request  *http.Request
		response *httptest.ResponseRecorder
	}
	results := make(chan result, 2)
	for range 2 {
		go func() {
			req, out := send("PUT", uuid.New(), tokens[0], origin, "image/png", pngBody)
			results <- result{req, out}
		}()
	}
	statuses := map[int]int{}
	for range 2 {
		r := <-results
		validateResponse(t, r.request, r.response)
		statuses[r.response.Code]++
	}
	if statuses[200] != 1 || statuses[409] != 1 {
		t.Fatalf("quota race: %v", statuses)
	}
	call("PUT", id, tokens[0], origin, "image/png", original, 200)

	owner := owners[0]
	previews := shortpost.PreviewStore{DB: db}
	posts := shortpost.PostStore{DB: db}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	prepare := func(imageID uuid.UUID) (uuid.UUID, shortpost.PreparePreview) {
		t.Helper()
		previewID := uuid.New()
		in := shortpost.PreparePreview{Title: "短帖", Content: "合成预览正文", ImageIDs: []uuid.UUID{imageID}}
		if _, err := previews.Prepare(ctx, owner, previewID, in); err != nil {
			t.Fatal(err)
		}
		return previewID, in
	}
	expire := func(preview uuid.UUID) {
		exec("UPDATE short_post_previews SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 HOUR WHERE owner_id=? AND id=?", owner[:], preview[:])
	}
	expiredPreview, expiredInput := prepare(id)
	expire(expiredPreview)
	var retained []uuid.UUID
	for range 2 {
		var imageID uuid.UUID
		if err := db.QueryRowContext(ctx, "SELECT id FROM short_post_images WHERE owner_id=? AND id<>? AND created_at>=UTC_TIMESTAMP(6)-INTERVAL 1 HOUR ORDER BY id LIMIT 1", owner[:], id[:]).Scan(&imageID); err != nil {
			t.Fatal(err)
		}
		retained = append(retained, imageID)
		exec("UPDATE short_post_images SET created_at=UTC_TIMESTAMP(6)-INTERVAL 25 HOUR WHERE owner_id=? AND id=?", owner[:], imageID[:])
	}
	published, _ := prepare(retained[0])
	mutation := uuid.New()
	submission := shortpost.SubmitPost{PreviewID: published, RightsConfirmed: true}
	receipt, err := posts.Submit(ctx, owner, mutation, submission)
	if err != nil {
		t.Fatal(err)
	}
	expire(published)
	livePreview, _ := prepare(retained[1])
	exec("UPDATE short_post_images SET created_at=UTC_TIMESTAMP(6)-INTERVAL 25 HOUR WHERE owner_id=? AND id=?", owner[:], id[:])

	_, _, err = shortpost.CleanupTemporaryMaterial(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := previews.Prepare(ctx, owner, expiredPreview, expiredInput); !errors.Is(err, shortpost.ErrPreviewExpired) {
		t.Fatalf("expired request replay: %v", err)
	}
	var previewPurged bool
	if err := db.QueryRowContext(ctx, "SELECT purged_at IS NOT NULL AND content='' FROM short_post_previews WHERE owner_id=? AND id=?", owner[:], expiredPreview[:]).Scan(&previewPurged); err != nil || !previewPurged {
		t.Fatalf("expired content was not cleared: %v", err)
	}
	upload := call("PUT", id, tokens[0], origin, "image/png", original, 409)
	if !strings.Contains(upload.Body.String(), "short_post_image_unavailable") {
		t.Fatal("reclaimed upload did not request a new UUID")
	}
	call("GET", id, tokens[0], "", "", nil, 404)
	for _, id := range retained {
		call("GET", id, tokens[0], "", "", nil, 200)
	}
	if replay, err := posts.Submit(ctx, owner, mutation, submission); err != nil || replay.PostID != receipt.PostID {
		t.Fatalf("submitted snapshot replay changed: %v", err)
	}
	if preview, err := previews.Read(ctx, owner, livePreview); err != nil || len(preview.Images) != 1 {
		t.Fatalf("live preview lost its image: %v", err)
	}
	raceImage := uuid.New()
	call("PUT", raceImage, tokens[0], origin, "image/png", pngBody, 200)
	call("PUT", uuid.New(), tokens[0], origin, "image/png", pngBody, 200)
	call("PUT", uuid.New(), tokens[0], origin, "image/png", pngBody, 409)
	exec("UPDATE short_post_images SET created_at=UTC_TIMESTAMP(6)-INTERVAL 25 HOUR WHERE owner_id=? AND id=?", owner[:], raceImage[:])
	start := make(chan struct{})
	swept := make(chan error, 1)
	go func() {
		<-start
		_, _, err := shortpost.CleanupTemporaryMaterial(ctx, db)
		swept <- err
	}()
	close(start)
	racePreview := uuid.New()
	_, prepareErr := previews.Prepare(ctx, owner, racePreview, shortpost.PreparePreview{Title: "短帖", Content: "并发预览", ImageIDs: []uuid.UUID{raceImage}})
	if err := <-swept; err != nil {
		t.Fatal(err)
	}
	switch {
	case prepareErr == nil:
		call("GET", raceImage, tokens[0], "", "", nil, 200)
		if preview, err := previews.Read(ctx, owner, racePreview); err != nil || len(preview.Images) != 1 {
			t.Fatalf("concurrent preview lost its image: %v", err)
		}
	case errors.Is(prepareErr, shortpost.ErrImageUnavailable):
		call("GET", raceImage, tokens[0], "", "", nil, 404)
	default:
		t.Fatalf("unexpected concurrent preparation error: %v", prepareErr)
	}
}
