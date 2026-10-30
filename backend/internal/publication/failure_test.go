package publication_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
)

// Wrap a real MySQL connection only in this test. No elevated DB privileges,
// global settings, production hooks or mocked transactions are needed.
func reviewFailureDB(t *testing.T) *sql.DB {
	t.Helper()
	cfg, e := mysql.ParseDSN(os.Getenv("TEST_MYSQL_DSN"))
	if e != nil {
		t.Fatal(e)
	}
	c, e := mysql.NewConnector(cfg)
	if e != nil {
		t.Fatal(e)
	}
	db := sql.OpenDB(faultConnector{c})
	t.Cleanup(func() { db.Close() })
	return db
}

type faultConnector struct{ driver.Connector }

func (c faultConnector) Connect(ctx context.Context) (driver.Conn, error) {
	conn, e := c.Connector.Connect(ctx)
	if e != nil {
		return nil, e
	}
	return faultConn{conn}, nil
}

type faultConn struct{ driver.Conn }

func (c faultConn) ExecContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	if strings.HasPrefix(q, "INSERT INTO publication_review_tasks ") {
		return nil, errors.New("injected_review_write_failure")
	}
	if x, ok := c.Conn.(driver.ExecerContext); ok {
		return x.ExecContext(ctx, q, args)
	}
	return nil, driver.ErrSkip
}
func (c faultConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	if x, ok := c.Conn.(driver.QueryerContext); ok {
		return x.QueryContext(ctx, q, args)
	}
	return nil, driver.ErrSkip
}
func (c faultConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	if x, ok := c.Conn.(driver.ConnBeginTx); ok {
		return x.BeginTx(ctx, opts)
	}
	return c.Conn.Begin()
}
