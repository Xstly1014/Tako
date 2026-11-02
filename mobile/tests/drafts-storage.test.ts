import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DraftError } from "../src/drafts/model.ts";
import { DraftRepository } from "../src/drafts/storage.ts";
import { SqliteCipherRows } from "../src/drafts/sqlite.ts";
import { fixture, TestDatabase } from "./helpers/drafts.ts";

test("真实 SQLite + AES-GCM：标题正文不落明文，重开仓储恢复，账号隔离", async (ctx) => {
  const f = await fixture(); ctx.after(f.close);
  const owner = randomUUID(), other = randomUUID(), key = randomUUID();
  const title = "PRIVATE_DRAFT_TITLE_保密合成", content = "PRIVATE_DRAFT_BODY_中文与表情😀";
  await f.repo.create(owner, key, title, content);
  const extra = new TestDatabase(f.db.path);
  const reopened = new DraftRepository(new SqliteCipherRows(extra), f.cipher);
  try {
    const loaded = await reopened.load(owner, key);
    assert.ok(loaded?.title === title && loaded.content === content);
    assert.equal(await reopened.load(other, key), null);
    assert.equal((await reopened.list(other)).length, 0);
    for (const suffix of ["", "-wal"]) {
      const bytes = readFileSync(f.db.path + suffix);
      assert.equal(bytes.includes(Buffer.from(title)), false);
      assert.equal(bytes.includes(Buffer.from(content)), false);
    }
  } finally { extra.raw.close(); }
});

test("加密内容篡改、跨账号/跨记录搬运、密钥丢失均拒绝且保留原数据", async (ctx) => {
  const f = await fixture(); ctx.after(f.close);
  const owner = randomUUID(), other = randomUUID(), key = randomUUID(), another = randomUUID();
  await f.repo.create(owner, key, "合成", "不可被另一账号领取");
  const row = await f.rows.read(owner, key);
  assert.ok(row);
  const bytes = Buffer.from(row.ciphertext, "base64");
  bytes[bytes.length - 1] ^= 1;
  f.db.raw.prepare("UPDATE private_drafts_v1 SET ciphertext=? WHERE owner=? AND local_id=?").run(bytes.toString("base64"), owner, key);
  await assert.rejects(f.repo.load(owner, key), (e: unknown) => e instanceof DraftError && e.code === "unreadable");
  f.db.raw.prepare("UPDATE private_drafts_v1 SET ciphertext=? WHERE owner=? AND local_id=?").run(row.ciphertext, owner, key);
  f.db.raw.prepare("INSERT INTO private_drafts_v1 VALUES(?,?,?,?)").run(other, key, row.revision, row.ciphertext);
  f.db.raw.prepare("INSERT INTO private_drafts_v1 VALUES(?,?,?,?)").run(owner, another, row.revision, row.ciphertext);
  for (const [o, k] of [[other, key], [owner, another]])
    await assert.rejects(f.repo.load(o, k), (e: unknown) => e instanceof DraftError && e.code === "unreadable");
  f.cipher.keys.delete(owner);
  await assert.rejects(f.repo.load(owner, key), DraftError);
  await assert.rejects(f.repo.create(owner, randomUUID()), DraftError);
  assert.ok((await f.rows.read(owner, key))?.ciphertext === row.ciphertext);
  assert.equal(f.cipher.keys.has(owner), false);
});

test("提交前中断回滚、提交后回执丢失可重读，旧编辑代次不覆盖", async (ctx) => {
  const f = await fixture(); ctx.after(f.close);
  const owner = randomUUID(), key = randomUUID();
  await f.repo.create(owner, key, "合成", "原有效快照");
  f.db.failBeforeCommit = true;
  await assert.rejects(f.repo.edit(owner, key, 1, "合成", "中断写入"), DraftError);
  assert.ok((await f.repo.load(owner, key))?.content === "原有效快照");
  f.db.failAfterCommit = true;
  await assert.rejects(f.repo.edit(owner, key, 1, "合成", "已提交但未确认"), DraftError);
  const loaded = await f.repo.load(owner, key);
  assert.equal(loaded?.seq, 2);
  assert.ok(loaded?.content === "已提交但未确认");
  await assert.rejects(f.repo.edit(owner, key, 1, "合成", "迟到编辑"), (e: unknown) => e instanceof DraftError && e.code === "local_conflict");
  assert.ok((await f.repo.load(owner, key))?.content === "已提交但未确认");
});

test("Unicode 与字节上限：非法输入不覆盖已暂存文字", async (ctx) => {
  const f = await fixture(); ctx.after(f.close);
  const owner = randomUUID(), key = randomUUID();
  await f.repo.create(owner, key, "😀".repeat(200), "合成");
  assert.throws(() => f.repo.edit(owner, key, 1, "😀".repeat(201), "合成"), DraftError);
  assert.throws(() => f.repo.edit(owner, key, 1, "合成", "中".repeat(350000)), DraftError);
  assert.equal((await f.repo.load(owner, key))?.seq, 1);
});

test("真实子进程在 SQLite 提交前退出，重读仍保留已确认密文", async (ctx) => {
  const f = await fixture(); ctx.after(f.close);
  const owner = randomUUID(), key = randomUUID();
  await f.repo.create(owner, key, "合成", "进程退出前的有效快照");
  const before = await f.rows.read(owner, key);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import {DatabaseSync} from 'node:sqlite';
     const db=new DatabaseSync(process.argv[1]);
     db.exec('BEGIN IMMEDIATE');
     db.prepare('UPDATE private_drafts_v1 SET ciphertext=? WHERE owner=? AND local_id=?').run('uncommitted',process.argv[2],process.argv[3]);
     process.exit(0);`, f.db.path, owner, key], { timeout: 10000, stdio: "pipe" });
  assert.equal(child.status, 0);
  assert.ok((await f.rows.read(owner, key))?.ciphertext === before?.ciphertext);
  assert.ok((await f.repo.load(owner, key))?.content === "进程退出前的有效快照");
});


test("授权仓储：无授权不打开数据库、离线可读写本人、锁定及换号隐藏全部旧稿", async (ctx) => {
  const { AuthorizedDrafts } = await import("../src/drafts/authorized.ts");
  const { lockedDraftAccess } = await import("../src/drafts/access.ts");
  const f = await fixture(); ctx.after(f.close);
  const owner = randomUUID(), other = randomUUID(), localId = randomUUID();
  let identity = { drafts: lockedDraftAccess(), generation: 1, busy: false };
  let opens = 0;
  const guarded = new AuthorizedDrafts(async () => { opens++; return f.repo; }, () => identity);
  await assert.rejects(guarded.list());
  assert.equal(opens, 0);
  identity = { drafts: { phase: "offline", owner }, generation: 2, busy: false };
  await guarded.create(localId, "离线合成稿", "中文😀");
  const draft = await guarded.load(localId);
  assert.equal(draft?.seq, 1);
  await guarded.edit(localId, 1, "继续写", "续写合成正文");
  identity = { drafts: lockedDraftAccess(), generation: 3, busy: false };
  await assert.rejects(guarded.load(localId));
  identity = { drafts: { phase: "online", owner: other }, generation: 4, busy: false };
  assert.equal((await guarded.list()).length, 0);
  assert.equal(await guarded.load(localId), null);
  identity = { drafts: { phase: "confirmation", owner }, generation: 5, busy: false };
  await assert.rejects(guarded.list());
  identity = { drafts: { phase: "online", owner }, generation: 5, busy: false };
  assert.equal((await guarded.load(localId))?.seq, 2);
});

test("授权仓储：打开/解密期间切换代次，迟到结果不得交给新视图", async (ctx) => {
  const { AuthorizedDrafts } = await import("../src/drafts/authorized.ts");
  const f = await fixture(); ctx.after(f.close);
  const owner = randomUUID(), key = randomUUID();
  await f.repo.create(owner, key, "合成", "保留的输入");
  let generation = 1;
  let finish: (value: DraftRepository) => void = () => {};
  const guarded = new AuthorizedDrafts(() => new Promise(resolve => { finish = resolve; }),
    () => ({ drafts: { phase: "online", owner }, generation, busy: false }));
  const pending = guarded.load(key), denied = assert.rejects(pending);
  generation++;
  finish(f.repo);
  await denied;
  assert.equal((await f.repo.load(owner, key))?.content, "保留的输入");
  const original = f.cipher.open.bind(f.cipher);
  let finishDecrypt: () => void = () => {};
  let started: () => void = () => {};
  const decryptStarted = new Promise<void>(resolve => { started = resolve; });
  f.cipher.open = async (...args) => {
    const plain = await original(...args);
    return new Promise(resolve => { finishDecrypt = () => resolve(plain); started(); });
  };
  const active = new AuthorizedDrafts(async () => f.repo,
    () => ({ drafts: { phase: "online", owner }, generation, busy: false }));
  const decrypting = active.load(key), stale = assert.rejects(decrypting);
  await decryptStarted;
  generation++;
  finishDecrypt();
  await stale;
});
