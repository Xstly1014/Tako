package main

import (
	"context"
	"encoding/json"
	"flag"
	"os"
	"os/signal"
	"syscall"
	"writing.local/community/internal/synthetic"
)

func main() {
	users := flag.Int("users", 1000, "synthetic account count")
	works := flag.Int("works", 20000, "synthetic work count")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	c := synthetic.Config{DSN: os.Getenv("MYSQL_DSN"), Environment: os.Getenv("APP_ENVIRONMENT"), Namespace: os.Getenv("TEST_DATASET_ID"), Users: *users, Works: *works, Passwords: [3]string{os.Getenv("TEST_OPERATOR_PASSWORD"), os.Getenv("TEST_AUTHOR_PASSWORD"), os.Getenv("TEST_READER_PASSWORD")}}
	err := synthetic.Run(ctx, c, func(p synthetic.Progress) { json.NewEncoder(os.Stdout).Encode(p) })
	if err != nil {
		json.NewEncoder(os.Stderr).Encode(map[string]string{"event": "synthetic_seed_failed", "code": err.Error()})
		os.Exit(1)
	}
}
