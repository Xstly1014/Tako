// Isolated real-HTTP acceptance fixture, never a deployment entry point.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/httpapi"
	"writing.local/community/internal/identity"
	"writing.local/community/internal/publication"
)

func main() {
	conf, e := mysql.ParseDSN(os.Getenv("TEST_MYSQL_DSN"))
	if e != nil || conf.DBName != "writing_search_test" {
		panic("isolated_search_database_required")
	}
	db, e := sql.Open("mysql", conf.FormatDSN())
	if e != nil {
		panic("fixture_database_unavailable")
	}
	defer db.Close()
	db.SetMaxOpenConns(4)
	owner := uuid.New()
	if _, e = db.Exec("INSERT INTO accounts(id,email,nickname) VALUES(?,?,?)", owner[:], owner.String()+"@example.test", "搜索验收作者"); e != nil {
		panic("fixture_account_failed")
	}
	defer func() {
		for _, q := range []string{"DELETE FROM work_state_mutations WHERE owner_id=?", "DELETE e FROM work_events e JOIN works w ON w.id=e.work_id WHERE w.owner_id=?", "DELETE q FROM publication_review_tasks q JOIN works w ON w.id=q.work_id WHERE w.owner_id=?", "DELETE FROM publication_mutations WHERE owner_id=?", "DELETE v FROM work_versions v JOIN works w ON w.id=v.work_id WHERE w.owner_id=?", "DELETE FROM publication_previews WHERE owner_id=?", "DELETE FROM works WHERE owner_id=?", "DELETE FROM publication_policies WHERE owner_id=?", "DELETE FROM draft_mutations WHERE owner_id=?", "DELETE FROM drafts WHERE owner_id=?", "DELETE FROM accounts WHERE id=?"} {
			db.Exec(q, owner[:])
		}
	}()
	ctx := context.Background()
	store := publication.Store{DB: db}
	for i := 0; i < 16; i++ {
		d, err := (draft.Store{DB: db}).Write(ctx, owner, "create", draft.Write{MutationID: uuid.New(), Title: fmt.Sprintf("合成搜索_%%! 世界%d", i), Content: "合成正文专用词-不得参与元数据搜索"})
		if err != nil {
			panic("fixture_draft_failed")
		}
		preview, err := store.Prepare(ctx, owner, publication.Prepare{MutationID: uuid.New(), DraftID: d.DraftID, SourceRevision: 1, Introduction: "合成星海简介", Tags: []string{"幻想"}, RightsConfirmed: true})
		if err != nil {
			panic("fixture_preview_failed")
		}
		work, err := store.Publish(ctx, owner, publication.Publish{MutationID: uuid.New(), PreviewID: preview.ID})
		if err != nil {
			panic("fixture_publish_failed")
		}
		if i == 14 {
			db.Exec("UPDATE works SET author_hidden=TRUE WHERE id=?", work.WorkID[:])
		}
		if i == 15 {
			db.Exec("UPDATE work_versions SET platform_limited=TRUE WHERE work_id=?", work.WorkID[:])
		}
	}
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	e = (httpapi.API{DB: db, Drafts: draft.Store{DB: db}, Identity: &identity.Service{DB: db, Pepper: []byte(strings.Repeat("fixture-only-", 4))}, Origin: "http://127.0.0.1:3320", AuthMode: "password", EnvironmentName: "test", EnablePublications: true}).Register(r)
	if e != nil {
		panic("fixture_routes_failed")
	}
	server := &http.Server{Addr: ":8080", Handler: r, ReadHeaderTimeout: 5 * time.Second}
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, syscall.SIGTERM, os.Interrupt)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			panic("fixture_listener_failed")
		}
	}()
	fmt.Println("search_fixture_ready")
	<-stopped
	end, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server.Shutdown(end)
}
