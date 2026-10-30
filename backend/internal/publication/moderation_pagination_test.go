package publication_test

import (
	"context"
	"testing"
)

func TestModerationStablePaginationAndOwnership(t *testing.T) {
	s, o, other, _, r := moderationFixture(t)
	ctx := context.Background()
	for i := 0; i < 25; i++ {
		res, e := s.DB.Exec("INSERT INTO moderation_cases(owner_id,work_id,version,scope,reason,created_at) VALUES(?,?,1,'version','分页夹具',UTC_TIMESTAMP(6))", o[:], r.WorkID[:])
		if e != nil {
			t.Fatal(e)
		}
		id, _ := res.LastInsertId()
		if _, e = s.DB.Exec("INSERT INTO moderation_appeals(case_id,reason,decision_reason,created_at) VALUES(?,'复核分页夹具','',UTC_TIMESTAMP(6))", id); e != nil {
			t.Fatal(e)
		}
	}
	cases, e := s.Cases(ctx, o, 0)
	if e != nil || len(cases.Items) != 20 || cases.Next == 0 {
		t.Fatal(cases, e)
	}
	next, e := s.Cases(ctx, o, cases.Next)
	if e != nil || len(next.Items) != 5 || next.Next != 0 {
		t.Fatal(next, e)
	}
	none, e := s.Cases(ctx, other, 0)
	if e != nil || len(none.Items) != 0 {
		t.Fatal("cross-account case list", e)
	}
	page, e := s.Appeals(ctx, 0, 0, true)
	if e != nil {
		t.Fatal(e)
	}
	last := uint64(0)
	seen := map[uint64]bool{}
	for {
		for _, a := range page.Items {
			if a.ID <= last || seen[a.ID] {
				t.Fatal("unstable pending queue")
			}
			seen[a.ID] = true
			last = a.ID
		}
		if page.Next == 0 {
			break
		}
		page, e = s.Appeals(ctx, 0, page.Next, true)
		if e != nil {
			t.Fatal(e)
		}
	}
	if len(seen) < 25 {
		t.Fatal("pending queue lost rows")
	}
}
