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

// N1-A book request storage/coordination shares this existing private-storage gate.
import { ApiError } from "../src/api/client.ts";
import { NovelsApi, validMetadata, type Novel } from "../src/api/novels.ts";
import { BookWriter, type PendingBook } from "../src/novels/writer.ts";
import { EncryptedBookJournal } from "../src/novels/journal.ts";
const bookPending = (): PendingBook => ({target:null,input:{mutation_id:randomUUID(),base_revision:0,title:"PRIVATE_BOOK_冒险😀",introduction:"合成简介",tags:["幻想"]}});
const resultFor = (p:PendingBook):Novel => ({id:p.target??randomUUID(),title:p.input.title,introduction:p.input.introduction,tags:p.input.tags,revision:p.input.base_revision+1,created_at:new Date().toISOString(),saved_at:new Date().toISOString()});
test("N1-A：书籍未知创建重开后只查原回执，密文隔离且无重复POST",async ctx=>{
 const f=await fixture();ctx.after(f.close);const owner=randomUUID(),other=randomUUID(),pending=bookPending();
 const journal=new EncryptedBookJournal(f.rows,f.cipher,owner,()=>true);let posts=0;const result=resultFor(pending);
 const remote={async write(){posts++;throw new ApiError("network");},async receipt(){return result;}};
 const writer=new BookWriter(journal,remote,()=>true);await writer.restore();await writer.submit(pending);
 assert.equal(writer.snapshot().phase,"unknown");assert.equal(posts,1);
 const otherJournal=new EncryptedBookJournal(f.rows,f.cipher,other,()=>true);assert.equal(await otherJournal.load(),null);
 for(const suffix of ["","-wal"]){assert.equal(readFileSync(f.db.path+suffix).includes(Buffer.from(pending.input.title)),false);}
 const reopened=new BookWriter(new EncryptedBookJournal(f.rows,f.cipher,owner,()=>true),remote,()=>true);
 await reopened.restore();await reopened.retry();assert.equal(reopened.snapshot().phase,"confirmed");assert.equal(posts,1);assert.equal(await journal.load(),null);
});
test("N1-A：无回执重试沿用固定载荷，CAS拒绝保留原输入且不循环POST",async()=>{
 const p=bookPending();p.target=randomUUID();p.input.base_revision=2;let stored:PendingBook|null=p;let submitted:PendingBook|undefined;
 const writer=new BookWriter({async load(){return stored;},async save(v){stored=v;}},{async receipt(){throw new ApiError("resource_not_found","",404);},async write(target,input){submitted={target,input};throw new ApiError("novel_revision_conflict","",409);}},()=>true);
 await writer.restore();await writer.retry();assert.deepEqual(submitted,p);assert.equal(writer.snapshot().phase,"rejected");assert.equal(stored,null);assert.equal(p.input.base_revision,2);
});
test("N1-A：落盘前故障不发请求；成功后清理故障不把已确认写入变未知",async()=>{
 const p=bookPending();let posts=0,stored:PendingBook|null=null,fail=true;
 const journal={async load(){return stored;},async save(v:PendingBook|null){if(fail)throw new ApiError("storage");stored=v;}};
 const api={async write(){posts++;fail=true;return resultFor(p);},async receipt(){throw new Error("unexpected");}};
 const w=new BookWriter(journal,api,()=>true);await w.restore();await w.submit(p);assert.equal(posts,0);
 fail=false;await w.submit(p);assert.equal(posts,1);assert.equal(w.snapshot().phase,"confirmed");assert.ok(w.snapshot().pending);
 fail=false;await w.retry();assert.equal(w.snapshot().phase,"confirmed");assert.equal(w.snapshot().pending,null);assert.equal(posts,1);
});
test("N1-A：迟到成功不能展示给另一账号，原账号仍可恢复提交",async()=>{
 const p=bookPending();let current=true,stored:PendingBook|null=null,finish!:(v:Novel)=>void;
 const w=new BookWriter({async load(){return stored;},async save(v){stored=v;}},{async write(){return new Promise<Novel>(resolve=>finish=resolve);},async receipt(){return resultFor(p);}},()=>current);
 await w.restore();const task=w.submit(p);await new Promise(resolve=>setImmediate(resolve));current=false;finish(resultFor(p));await task;
 assert.equal(w.snapshot().result,null);assert.deepEqual(stored,p);
});
test("N1-A：已存在密文的密钥丢失不能用新密钥覆盖待确认请求",async ctx=>{
 const f=await fixture();ctx.after(f.close);const owner=randomUUID(),p=bookPending();const journal=new EncryptedBookJournal(f.rows,f.cipher,owner,()=>true);
 await journal.save(p);const before=await f.rows.read(owner,(await f.rows.ids(owner))[0]);f.cipher.keys.delete(owner);
 await assert.rejects(journal.load(),ApiError);await assert.rejects(journal.save(null),ApiError);
 assert.deepEqual(await f.rows.read(owner,(await f.rows.ids(owner))[0]),before);assert.equal(f.cipher.keys.has(owner),false);
});
test("N1-A：资料Unicode边界和错目标响应契约拒绝",async()=>{
 assert.equal(validMetadata({title:"😀".repeat(200),introduction:"",tags:["幻想"]}),true);
 assert.equal(validMetadata({title:"\ud800",introduction:"",tags:["幻想"]}),false);
 assert.equal(validMetadata({title:"a",introduction:"",tags:["幻想","幻想"]}),false);
 const p=bookPending(),expected=randomUUID();const api=new NovelsApi(async<T>()=>resultFor(p) as T);
 await assert.rejects(api.read(expected),e=>e instanceof ApiError&&e.code==="contract");
});

test("N1-A：两个页面竞争同账号journal不能覆盖，也不能清掉另一请求",async ctx=>{
 const f=await fixture();ctx.after(f.close);const owner=randomUUID(),p=bookPending(),other=bookPending();
 const first=new EncryptedBookJournal(f.rows,f.cipher,owner,()=>true),second=new EncryptedBookJournal(f.rows,f.cipher,owner,()=>true);
 await first.save(p);await assert.rejects(second.save(other),e=>e instanceof ApiError&&e.code==="novel_request_pending");
 await assert.rejects(second.save(null,other.input.mutation_id),e=>e instanceof ApiError&&e.code==="novel_request_pending");
 assert.deepEqual(await second.load(),p);await first.save(null,p.input.mutation_id);assert.equal(await first.load(),null);
});

test("N1-A：慢存储提交前即冻结表单，重复提交不增加请求",async()=>{
 const p=bookPending();let writes=0,release!:()=>void;
 const first=new Promise<void>(resolve=>release=resolve);let saving=true;
 const w=new BookWriter({async load(){return null;},async save(){if(saving){await first;saving=false;}}},{async write(){writes++;return resultFor(p);},async receipt(){throw new Error("unexpected");}},()=>true);
 await w.restore();const task=w.submit(p);assert.equal(w.snapshot().phase,"saving");await w.submit(bookPending());assert.equal(writes,0);release();await task;assert.equal(writes,1);assert.equal(w.snapshot().phase,"confirmed");
});
