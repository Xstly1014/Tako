// Package synthetic imports explicitly labelled fixtures into the dedicated
// sandbox only. It is not linked into the production API executable.
package synthetic

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"writing.local/community/internal/draft"
	"writing.local/community/internal/publication"
)

const Version = 1

type Config struct {
	DSN, Environment, Namespace string
	Users, Works                int
	Passwords                   [3]string
}
type Progress struct {
	Event     string `json:"event"`
	Inserted  int    `json:"inserted_works"`
	Present   int    `json:"already_present"`
	Requested int    `json:"requested_works"`
}
type failure struct{ code string }

func (e failure) Error() string { return e.code }
func fail(code string, err error) error {
	if err == nil {
		return nil
	}
	var db *mysql.MySQLError
	if errors.As(err, &db) {
		return failure{fmt.Sprintf("%s_mysql_%d", code, db.Number)}
	}
	return failure{code}
}
func AccountID(namespace uuid.UUID, i int) uuid.UUID {
	return uuid.NewSHA1(namespace, []byte(fmt.Sprintf("account/%d", i)))
}
func WorkID(namespace uuid.UUID, i int) uuid.UUID {
	return uuid.NewSHA1(namespace, []byte(fmt.Sprintf("work/%d", i)))
}
func objectID(namespace uuid.UUID, kind string, i, v int) uuid.UUID {
	return uuid.NewSHA1(namespace, []byte(fmt.Sprintf("%s/%d/%d", kind, i, v)))
}
func hash(value any) []byte { raw, _ := json.Marshal(value); sum := sha256.Sum256(raw); return sum[:] }

func validate(c Config) (uuid.UUID, error) {
	parsed, err := mysql.ParseDSN(c.DSN)
	if err != nil || parsed.DBName != "tako_sandbox" || parsed.User == "root" || c.Environment != "test" {
		return uuid.Nil, failure{"seed_target_rejected"}
	}
	ns, err := uuid.Parse(c.Namespace)
	if err != nil || ns == uuid.Nil {
		return uuid.Nil, failure{"seed_namespace_invalid"}
	}
	if c.Users < 3 || c.Users > 100000 || c.Works < 1 || c.Works > 500000 {
		return uuid.Nil, failure{"seed_counts_invalid"}
	}
	for _, password := range c.Passwords {
		if len(password) < 16 || len(password) > 72 {
			return uuid.Nil, failure{"test_password_configuration_invalid"}
		}
	}
	return ns, nil
}

func Run(ctx context.Context, c Config, notify func(Progress)) error {
	ns, err := validate(c)
	if err != nil {
		return err
	}
	db, err := sql.Open("mysql", c.DSN)
	if err != nil {
		return fail("seed_connect_failed", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	var environment, namespace string
	var base time.Time
	var version int
	err = db.QueryRowContext(ctx, "SELECT environment,namespace,base_time,generator_version FROM synthetic_environment_guard WHERE id=1").Scan(&environment, &namespace, &base, &version)
	if err != nil || environment != "test" || namespace != ns.String() || version != Version {
		return failure{"seed_database_marker_rejected"}
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return fail("seed_lock_connection", err)
	}
	defer conn.Close()
	var locked int
	if err = conn.QueryRowContext(ctx, "SELECT GET_LOCK('tako_synthetic_import',0)").Scan(&locked); err != nil || locked != 1 {
		return failure{"seed_already_running"}
	}
	defer conn.ExecContext(context.Background(), "DO RELEASE_LOCK('tako_synthetic_import')")
	var maxUser, maxWork sql.NullInt64
	if err = db.QueryRowContext(ctx, "SELECT MAX(IF(kind='account',ordinal,NULL)),MAX(IF(kind='work',ordinal,NULL)) FROM synthetic_seed_items").Scan(&maxUser, &maxWork); err != nil {
		return fail("seed_manifest_read", err)
	}
	if (maxUser.Valid && maxUser.Int64 >= int64(c.Users)) || (maxWork.Valid && maxWork.Int64 > int64(c.Works)) {
		return failure{"seed_cannot_shrink_existing_dataset"}
	}
	if err = seedAccounts(ctx, db, ns, base, c); err != nil {
		return err
	}
	existing := map[int]bool{}
	rows, err := db.QueryContext(ctx, "SELECT ordinal FROM synthetic_seed_items WHERE kind='work'")
	if err != nil {
		return fail("seed_manifest_read", err)
	}
	for rows.Next() {
		var n int
		if err = rows.Scan(&n); err != nil {
			rows.Close()
			return fail("seed_manifest_read", err)
		}
		existing[n] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return fail("seed_manifest_read", err)
	}
	runID := uuid.New()
	if _, err = db.ExecContext(ctx, "INSERT INTO synthetic_seed_runs(id,requested_users,requested_works) VALUES(?,?,?)", runID[:], c.Users, c.Works); err != nil {
		return fail("seed_run_start", err)
	}
	complete := false
	defer func() {
		if !complete {
			db.ExecContext(context.Background(), "UPDATE synthetic_seed_runs SET state='failed',completed_at=UTC_TIMESTAMP(6) WHERE id=?", runID[:])
		}
	}()
	inserted, present := 0, 0
	for start := 1; start <= c.Works; start += 100 {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fail("seed_batch_begin", err)
		}
		batch := 0
		for i := start; i < start+100 && i <= c.Works; i++ {
			if existing[i] {
				present++
				continue
			}
			if err = seedWork(ctx, tx, ns, base, c.Users, i); err != nil {
				tx.Rollback()
				return err
			}
			batch++
		}
		if _, err = tx.ExecContext(ctx, "UPDATE synthetic_seed_runs SET inserted_works=? WHERE id=?", inserted+batch, runID[:]); err != nil {
			tx.Rollback()
			return fail("seed_progress_write", err)
		}
		if err = tx.Commit(); err != nil {
			return fail("seed_batch_commit", err)
		}
		inserted += batch
		if notify != nil && (start%1000 == 1 || start+100 > c.Works) {
			notify(Progress{"synthetic_seed_progress", inserted, present, c.Works})
		}
	}
	if err = seedCurations(ctx, db, ns, c.Works); err != nil {
		return err
	}
	if _, err = db.ExecContext(ctx, "UPDATE synthetic_seed_runs SET state='complete',completed_at=UTC_TIMESTAMP(6) WHERE id=?", runID[:]); err != nil {
		return fail("seed_run_finish", err)
	}
	complete = true
	if notify != nil {
		notify(Progress{"synthetic_seed_complete", inserted, present, c.Works})
	}
	return nil
}

func seedAccounts(ctx context.Context, db *sql.DB, ns uuid.UUID, base time.Time, c Config) error {
	var hashes [3][]byte
	for i, password := range c.Passwords {
		var err error
		hashes[i], err = bcrypt.GenerateFromPassword([]byte(password), 12)
		if err != nil {
			return fail("seed_password_hash", err)
		}
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fail("seed_accounts_begin", err)
	}
	defer tx.Rollback()
	for i := 0; i < c.Users; i++ {
		var exists int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM synthetic_seed_items WHERE kind='account' AND ordinal=?", i).Scan(&exists); err != nil {
			return fail("seed_account_manifest", err)
		}
		if exists != 0 {
			continue
		}
		id := AccountID(ns, i)
		email := fmt.Sprintf("writer%05d@tako-test.invalid", i)
		nickname := authorName(i)
		if i < 3 {
			email = []string{"operator@tako-test.invalid", "author@tako-test.invalid", "reader@tako-test.invalid"}[i]
			nickname = []string{"测试运营", "测试作者", "测试读者"}[i]
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO accounts(id,email,nickname,created_at) VALUES(?,?,?,?)", id[:], email, nickname, base.Add(-365*24*time.Hour)); err != nil {
			return fail("seed_account_insert", err)
		}
		if i < 3 {
			if _, err = tx.ExecContext(ctx, "INSERT INTO account_passwords(account_id,password_hash) VALUES(?,?)", id[:], hashes[i]); err != nil {
				return fail("seed_password_insert", err)
			}
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO synthetic_seed_items(kind,ordinal,object_id) VALUES('account',?,?)", i, id[:]); err != nil {
			return fail("seed_account_manifest", err)
		}
	}
	return fail("seed_accounts_commit", tx.Commit())
}

func seedWork(ctx context.Context, tx *sql.Tx, ns uuid.UUID, base time.Time, users, index int) error {
	ownerIndex := (index*149 + index/23) % users
	if ownerIndex == 2 {
		ownerIndex = 3 % users
	}
	if index <= 12 {
		ownerIndex = 1
	}
	owner, work, draftID := AccountID(ns, ownerIndex), WorkID(ns, index), objectID(ns, "draft", index, 0)
	versions := 1
	if index%10 == 0 {
		versions = 3
	}
	if index%100 == 0 {
		versions = 12
	}
	step := 6 * time.Hour
	first := base.Add(-time.Duration((index*17)%4320+96) * time.Hour)
	if index%101 == 0 {
		step = 15 * time.Minute
		first = base.Add(-time.Duration(versions+1) * step)
	}
	hidden, limited := index%100 == 3, index%100 == 4
	display := versions
	if versions > 1 && index%9 == 0 {
		display = 1
	}
	history := index%3 == 0
	last := first.Add(time.Duration(versions-1) * step)
	title, content := versionText(index, versions)
	if _, err := tx.ExecContext(ctx, "INSERT INTO drafts(id,owner_id,title,content,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", draftID[:], owner[:], title, content, versions, first.Add(-time.Minute), last); err != nil {
		return fail("seed_draft_insert", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO works(id,owner_id,source_draft_id,last_version,display_version,author_hidden,history_open,platform_limited,state_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", work[:], owner[:], draftID[:], versions, display, hidden, history, limited, versions+1, first); err != nil {
		return fail("seed_work_insert", err)
	}
	tags := []string{publication.Tags[index%len(publication.Tags)]}
	if index%4 == 0 {
		tags = append(tags, publication.Tags[(index+1)%len(publication.Tags)])
	}
	sort.Strings(tags)
	tagJSON, _ := json.Marshal(tags)
	for v := 1; v <= versions; v++ {
		at := first.Add(time.Duration(v-1) * step)
		title, body := versionText(index, v)
		mutation := objectID(ns, "draft-mutation", index, v)
		operation := "create"
		input := draft.Write{MutationID: mutation, Title: title, Content: body}
		if v > 1 {
			operation = "save"
			input.DraftID = draftID
			input.BaseRevision = uint64(v - 1)
		}
		digest := hash(struct {
			Operation string
			Input     draft.Write
		}{operation, input})
		if _, err := tx.ExecContext(ctx, "INSERT INTO draft_mutations(owner_id,mutation_id,operation,payload_hash,result_draft_id,result_revision,result_saved_at,created_at) VALUES(?,?,?,?,?,?,?,?)", owner[:], mutation[:], operation, digest, draftID[:], v, at, at); err != nil {
			return fail("seed_draft_receipt", err)
		}
		next := first.Add(time.Duration(v) * step)
		keep := v == versions || at.After(base.Add(-24*time.Hour)) || (at.After(base.Add(-30*24*time.Hour)) && at.UTC().Day() != next.UTC().Day())
		if keep {
			if _, err := tx.ExecContext(ctx, "INSERT INTO draft_revisions(draft_id,revision,title,content,saved_at) VALUES(?,?,?,?,?)", draftID[:], v, title, body, at); err != nil {
				return fail("seed_snapshot_insert", err)
			}
		}
		preview := objectID(ns, "preview", index, v)
		prepareID := objectID(ns, "prepare-mutation", index, v)
		intro := introduction(index)
		prepare := publication.Prepare{MutationID: prepareID, DraftID: draftID, SourceRevision: uint64(v), RightsConfirmed: true, Introduction: intro, Tags: tags}
		if _, err := tx.ExecContext(ctx, `INSERT INTO publication_previews(id,owner_id,mutation_id,payload_hash,draft_id,source_revision,expected_version,title,content,introduction,tags,created_at,expires_at,consumed_work_id,consumed_version,consumed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, preview[:], owner[:], prepareID[:], hash(prepare), draftID[:], v, v-1, title, body, intro, tagJSON, at.Add(-time.Minute), at.Add(24*time.Hour-time.Minute), work[:], v, at); err != nil {
			return fail("seed_preview_insert", err)
		}
		versionLimited := (index%100 == 5 && v == display) || (versions > 1 && index%11 == 0 && v == 1)
		if _, err := tx.ExecContext(ctx, "INSERT INTO work_versions(work_id,version,preview_id,title,content,introduction,tags,platform_limited,published_at) VALUES(?,?,?,?,?,?,?,?,?)", work[:], v, preview[:], title, body, intro, tagJSON, versionLimited, at); err != nil {
			return fail("seed_version_insert", err)
		}
		publishID := objectID(ns, "publish-mutation", index, v)
		publish := publication.Publish{MutationID: publishID, PreviewID: preview, ExpectedVersion: uint64(v - 1)}
		if _, err := tx.ExecContext(ctx, "INSERT INTO publication_mutations(owner_id,mutation_id,payload_hash,work_id,version,published_at) VALUES(?,?,?,?,?,?)", owner[:], publishID[:], hash(publish), work[:], v, at); err != nil {
			return fail("seed_publication_receipt", err)
		}
		state := "approved"
		revision := 2
		if index%4 == 0 {
			state = "pending"
			revision = 1
		}
		if versionLimited {
			state = "restricted"
			revision = 2
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO publication_review_tasks(work_id,version,state,revision,first_waiting_at) VALUES(?,?,?,?,?)", work[:], v, state, revision, at); err != nil {
			return fail("seed_review_insert", err)
		}
		if versionLimited {
			if err := restriction(ctx, tx, ns, owner, work, index, v, "version", at); err != nil {
				return err
			}
		}
	}
	if limited {
		if err := restriction(ctx, tx, ns, owner, work, index, display, "work", last); err != nil {
			return err
		}
	}
	if display != versions {
		if _, err := tx.ExecContext(ctx, "INSERT INTO work_events(work_id,sequence,kind,version,public_visible,created_at) VALUES(?,?,'display_changed',?,?,?)", work[:], versions+1, display, !hidden && !limited, last); err != nil {
			return fail("seed_display_event", err)
		}
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO synthetic_seed_items(kind,ordinal,object_id) VALUES('work',?,?)", index, work[:]); err != nil {
		return fail("seed_work_manifest", err)
	}
	return nil
}

func restriction(ctx context.Context, tx *sql.Tx, ns, owner, work uuid.UUID, index, version int, scope string, at time.Time) error {
	reason := "[合成测试] 用于限制、复核与恢复的界面验收，不代表真实违规。"
	res, err := tx.ExecContext(ctx, "INSERT INTO moderation_cases(owner_id,work_id,version,scope,reason,created_at) VALUES(?,?,?,?,?,?)", owner[:], work[:], version, scope, reason, at)
	if err != nil {
		return fail("seed_restriction_insert", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fail("seed_restriction_id", err)
	}
	actor := AccountID(ns, 0)
	mutation := objectID(ns, "restriction-"+scope, index, version)
	result, _ := json.Marshal(publication.ModerationResult{ID: uint64(id), State: "active", Revision: 1})
	if _, err = tx.ExecContext(ctx, "INSERT INTO moderation_mutations(actor_id,mutation_id,owner_id,work_id,kind,reason,payload_hash,result,created_at) VALUES(?,?,?,?,?,?,?,?,?)", actor[:], mutation[:], owner[:], work[:], "synthetic_import", reason, hash(struct {
		Index, Version int
		Scope          string
	}{index, version, scope}), result, at); err != nil {
		return fail("seed_restriction_audit", err)
	}
	return nil
}

func seedCurations(ctx context.Context, db *sql.DB, ns uuid.UUID, works int) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fail("seed_curation_begin", err)
	}
	defer tx.Rollback()
	var revision uint64
	if err = tx.QueryRowContext(ctx, "SELECT revision FROM community_curation_state WHERE id=1 FOR UPDATE").Scan(&revision); err != nil {
		return fail("seed_curation_lock", err)
	}
	for pos, index := range []int{1, 2, 6, 9, 10, 11} {
		if index > works {
			continue
		}
		var done int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM synthetic_seed_items WHERE kind='curation' AND ordinal=?", pos+1).Scan(&done); err != nil {
			return fail("seed_curation_manifest", err)
		}
		if done != 0 {
			continue
		}
		work, actor, marker := WorkID(ns, index), AccountID(ns, 0), objectID(ns, "curation", pos+1, 0)
		// Fill only an unused initial position; a repeat import never overrides editorial changes.
		result, err := tx.ExecContext(ctx, "UPDATE community_curations c JOIN works w ON w.id=? JOIN work_versions v ON v.work_id=w.id AND v.version=w.display_version SET c.work_id=w.id,c.discovery_revision=w.discovery_revision,c.selected_by=?,c.selected_at=UTC_TIMESTAMP(6) WHERE c.slot=? AND c.work_id IS NULL AND w.discovery_revision=1 AND w.author_hidden=FALSE AND w.platform_limited=FALSE AND v.platform_limited=FALSE", work[:], actor[:], pos+1)
		if err != nil {
			return fail("seed_curation_update", err)
		}
		n, err := result.RowsAffected()
		if err != nil {
			return fail("seed_curation_update", err)
		}
		revision += uint64(n)
		if _, err = tx.ExecContext(ctx, "INSERT INTO synthetic_seed_items(kind,ordinal,object_id) VALUES('curation',?,?)", pos+1, marker[:]); err != nil {
			return fail("seed_curation_manifest", err)
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE community_curation_state SET revision=? WHERE id=1", revision); err != nil {
		return fail("seed_curation_revision", err)
	}
	return fail("seed_curation_commit", tx.Commit())
}

func authorName(index int) string {
	first := []string{"海盐", "青柠", "橘子", "月见", "雾岛", "星河", "晚风", "蓝鲸", "晴天", "可乐", "花火", "雪糕", "电波", "乌龙", "松鼠", "砂糖"}
	last := []string{"汽水", "信号", "骑士", "写手", "便利店", "收藏家", "观察员", "慢行者", "邮差", "地图", "漫游者", "记事簿", "航线", "路灯", "唱片", "天台"}
	return fmt.Sprintf("%s%s%02d", first[index%len(first)], last[(index/len(first))%len(last)], index/256)
}

func title(index int) string {
	starts := []string{"末班车之后", "写给周五的信", "海底邮局", "不想成为勇者", "第七次重启", "月亮便利店", "迟到的春天", "我们班的魔法师", "捡到一张异世界地图", "雨停之前", "深夜食堂营业中", "被星舰录取以后", "今天也没有拯救世界", "那个没发出去的表情", "我的室友是龙", "请把结局留到明天", "毕业前的最后一场雨", "无法存档的冒险", "手机里多了一座城", "关于猫突然开口这件事", "没有名字的车站", "同桌给我寄了封未来邮件", "校门口的时光机", "以为只是普通社团"}
	ends := []string{"一个普通人的非普通日常", "世界尽头还有早八", "别急，故事才刚开始", "平行宇宙里的小事", "从一次离谱的误会说起", "这回想换个结局", "我们总会在某处重逢", "勇气只有一杯奶茶那么多", "请不要在考试前穿越", "今天先讲到这里", "给生活加一点随机事件", "信号不好，但我听见了"}
	result := starts[index%len(starts)] + "：" + ends[(index/len(starts)+index*7)%len(ends)]
	if index%89 == 0 {
		result += " 🚀"
	}
	if index%431 == 0 {
		result = "当 <script> 遇见 & 海风：这是一段普通文字"
	}
	if index%137 == 0 {
		result += "——" + strings.Repeat("关于成长、冒险、朋友以及那些还没来得及说出口的小事", 8)
	}
	return truncate(result, 180)
}
func introduction(index int) string {
	if index%13 == 0 {
		return ""
	}
	intros := []string{
		"下课铃响起时，她收到一条来自明天的消息。消息很短：今天别走西门。她犹豫了三秒，决定先买杯奶茶。",
		"一个想安稳毕业的人，被迫成为了社团里唯一正常的成员。轻松日常，也有一点认真想说的话。",
		"如果每次说谎都会掉落一颗星星，城市的夜晚会变成什么样？这次冒险从一盏坏掉的路灯开始。",
		"凌晨两点，把一直没想明白的事写下来。关于朋友、分别、失败，还有第二天照常升起的太阳。",
		"地图上没有这座城，导航却坚持让我们继续向前。车里的四个人，都藏着一个不太普通的秘密。",
		"没有天选主角，也没有万能系统。有人想改变世界，有人只想把今晚的晚饭做好。",
	}
	if index%97 == 0 {
		return truncate(strings.Repeat(intros[index%len(intros)], 8), 300)
	}
	return intros[index%len(intros)]
}
func versionText(index, version int) (string, string) {
	heading := title(index)
	if version > 1 {
		heading = truncate(fmt.Sprintf("%s · 修订%d", heading, version), 200)
	}
	paragraphs := []string{
		"雨落下来的时候，我们刚好走到路口。对面的便利店还亮着灯，有人抱着一袋快要融化的冰淇淋，看起来比这场雨还着急。",
		"她把那张折过四次的地图摊在桌上。纸上的线条很旧，箭头却指向今天早上才新开的咖啡店。我们谁也没有先说话。",
		"我一直以为奇迹应该有很大的动静，至少要有一道闪电。后来才知道，奇迹也可能只是朋友发来的一句‘出来吃饭吗’。",
		"手机忽然震了一下。通知栏里没有名字，只有一句话：如果你还记得那个夏天，请在天黑之前回来。",
		"他们争论了十分钟到底该往哪边走，最后被一只路过的猫替大家做了决定。猫并不在意这件事，只关心谁还带着零食。",
		"故事当然可以有另一个结局。但在那之前，我们得先弄明白，谁把钥匙忘在了另一个世界。",
		"食堂的灯一盏盏熄灭，球场上还有人在跑。那些白天说不出口的话，似乎只有等到夜里，才会慢慢找到自己的位置。",
		"他说自己来自很远的地方。我们问有多远，他想了想，回答：大概是再也赶不上末班车的那种远。",
	}
	count := 7 + index%12
	if index%97 == 0 {
		count = 100
	}
	if index%193 == 0 {
		count = 2
	}
	var text strings.Builder
	fmt.Fprintf(&text, "【合成测试内容，不是真实用户投稿】\n\n%s\n\n", heading)
	for p := 0; p < count; p++ {
		fmt.Fprintf(&text, "%s\n\n", paragraphs[(index*7+p+version)%len(paragraphs)])
	}
	fmt.Fprintf(&text, "——样本 %d，正式修订 %d。此内容用于阅读、版本和排版验收。", index, version)
	return heading, text.String()
}
func truncate(value string, n int) string {
	runes := []rune(value)
	if len(runes) > n {
		return string(runes[:n])
	}
	return value
}
