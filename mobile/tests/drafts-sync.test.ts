import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DraftRepository } from "../src/drafts/storage.ts";
import { DraftSynchronizer, type DraftIdentity } from "../src/drafts/sync.ts";
import { ApiError } from "../src/api/client.ts";
import { DraftError } from "../src/drafts/model.ts";
import { fixture, TestApi } from "./helpers/drafts.ts";

async function setup(ctx: { after(fn: () => void): void }) {
  const f = await fixture(); ctx.after(f.close);
  const owner = randomUUID(), key = randomUUID(), api = new TestApi(owner);
  let identity: DraftIdentity = { owner, generation: 1, online: true };
  const worker = (repo = f.repo) => new DraftSynchronizer(repo, api, () => identity, randomUUID);
  await f.repo.create(owner, key, "合成", "首份草稿");
  return { ...f, owner, key, api, worker, changeIdentity: (v: DraftIdentity) => { identity = v; } };
}

test("先持久化原请求再发；丢响应重开后只创建一份，新输入不被旧回执确认", async (ctx) => {
  const f = await setup(ctx);
  f.api.dropNext = true;
  assert.equal((await f.worker().sync(f.owner, f.key)).state, "pending");
  const old = (await f.repo.load(f.owner, f.key))!;
  assert.ok(old.pending);
  await f.repo.edit(f.owner, f.key, old.seq, "合成", "首次请求后继续写");
  const reopened = new DraftRepository(f.rows, f.cipher);
  const result = await f.worker(reopened).sync(f.owner, f.key);
  assert.equal(result.state, "pending");
  assert.equal(f.api.receipts.size, 1);
  assert.equal(f.api.calls[0].body.mutation_id, f.api.calls[1].body.mutation_id);
  assert.ok(result.record?.content === "首次请求后继续写");
  assert.equal((await f.worker().sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.drafts.size, 1);
});

test("原请求落盘失败不发网络；服务确认后本机提交失败重试不重复写", async (ctx) => {
  const f = await setup(ctx);
  f.db.failBeforeCommit = true;
  await assert.rejects(f.worker().sync(f.owner, f.key), DraftError);
  assert.equal(f.api.calls.length, 0);
  f.api.beforeReceipt = async () => { f.db.failBeforeCommit = true; f.api.beforeReceipt = null; };
  await assert.rejects(f.worker().sync(f.owner, f.key), DraftError);
  assert.ok((await f.repo.load(f.owner, f.key))?.pending);
  assert.equal((await f.worker().sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.receipts.size, 1);
});

test("保存期间远端先改，409 后持久化唯一恢复请求，副本丢响应仍唯一", async (ctx) => {
  const f = await setup(ctx), sync = f.worker();
  await sync.sync(f.owner, f.key);
  const initial = (await f.repo.load(f.owner, f.key))!;
  await f.repo.edit(f.owner, f.key, initial.seq, "合成", "手机离线内容");
  const originalRead = f.api.read.bind(f.api);
  f.api.read = async (id) => {
    const old = await originalRead(id);
    f.api.drafts.set(id, { ...old, revision: old.revision + 1, content: "远端新文字" });
    return old;
  };
  f.api.dropNext = true;
  assert.equal((await sync.sync(f.owner, f.key)).state, "pending");
  assert.equal((await f.repo.load(f.owner, f.key))?.pending?.kind, "recover");
  f.api.read = originalRead;
  const result = await sync.sync(f.owner, f.key);
  assert.equal(result.state, "recovered");
  assert.notEqual(result.record?.serverId, initial.serverId);
  assert.ok(f.api.drafts.get(initial.serverId!)?.content === "远端新文字");
  assert.equal(f.api.drafts.size, 2);
  assert.equal(f.api.calls.filter((x) => x.kind === "recover")[0].body.mutation_id,
    f.api.calls.filter((x) => x.kind === "recover")[1].body.mutation_id);
});

test("已知远端新版直接另存；恢复期间新增输入保留且副本可继续同步", async (ctx) => {
  const f = await setup(ctx), sync = f.worker();
  await sync.sync(f.owner, f.key);
  const old = (await f.repo.load(f.owner, f.key))!;
  await f.repo.edit(f.owner, f.key, old.seq, "合成", "手机版本");
  const remote = f.api.drafts.get(old.serverId!)!;
  f.api.drafts.set(old.serverId!, { ...remote, revision: remote.revision + 1, content: "电脑版本" });
  f.api.beforeReceipt = async () => {
    const current = (await f.repo.load(f.owner, f.key))!;
    await f.repo.edit(f.owner, f.key, current.seq, "合成", "恢复请求后继续写");
    f.api.beforeReceipt = null;
  };
  const result = await sync.sync(f.owner, f.key);
  assert.equal(result.state, "recovered");
  assert.equal(result.record?.dirty, true);
  assert.ok(result.record?.content === "恢复请求后继续写");
  assert.equal((await sync.sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.drafts.size, 2);
});

test("离线/账号不符不发送，切号后的迟到回执不能确认或清空原输入", async (ctx) => {
  const f = await setup(ctx), sync = f.worker();
  f.changeIdentity({ owner: f.owner, generation: 1, online: false });
  assert.equal((await sync.sync(f.owner, f.key)).state, "login-required");
  assert.equal(f.api.calls.length, 0);
  f.changeIdentity({ owner: randomUUID(), generation: 2, online: true });
  assert.equal((await sync.sync(f.owner, f.key)).state, "account-mismatch");
  f.changeIdentity({ owner: f.owner, generation: 3, online: true });
  f.api.beforeReceipt = async () => { f.changeIdentity({ owner: randomUUID(), generation: 4, online: true }); };
  assert.equal((await sync.sync(f.owner, f.key)).state, "account-mismatch");
  const preserved = (await f.repo.load(f.owner, f.key))!;
  assert.ok(preserved.pending && preserved.dirty && preserved.content === "首份草稿");
  f.api.beforeReceipt = null;
  f.changeIdentity({ owner: f.owner, generation: 5, online: true });
  assert.equal((await sync.sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.receipts.size, 1);
});

test("401/503/限频保留冻结请求，明确输入拒绝后允许修改再提交", async (ctx) => {
  const f = await setup(ctx), sync = f.worker();
  for (const [error, state] of [[new ApiError("authentication_required", "", 401), "login-required"],
    [new ApiError("service_unavailable", "", 503), "pending"], [new ApiError("rate_limited", "", 429), "pending"]] as const) {
    f.api.fail = error;
    assert.equal((await sync.sync(f.owner, f.key)).state, state);
    assert.ok((await f.repo.load(f.owner, f.key))?.pending);
  }
  f.api.fail = new ApiError("invalid_input", "", 400);
  assert.equal((await sync.sync(f.owner, f.key)).state, "rejected");
  assert.equal((await f.repo.load(f.owner, f.key))?.pending, null);
  f.api.fail = null;
  assert.equal((await sync.sync(f.owner, f.key)).state, "saved");
});

test("错误修订回执不确认保存；提交互斥阻止同实例重复发送", async (ctx) => {
  const f = await setup(ctx), sync = f.worker();
  const write = f.api.write.bind(f.api);
  f.api.write = async (pending) => ({ ...await write(pending), revision: 7 });
  assert.equal((await sync.sync(f.owner, f.key)).state, "pending");
  assert.ok((await f.repo.load(f.owner, f.key))?.pending);
  f.api.write = write;
  let release!: () => void, arrived!: () => void;
  const ready = new Promise<void>((resolve) => { arrived = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  f.api.beforeReceipt = async () => { arrived(); await gate; };
  const operation = sync.sync(f.owner, f.key);
  await ready;
  assert.equal((await sync.sync(f.owner, f.key)).state, "busy");
  release();
  assert.equal((await operation).state, "saved");
  assert.equal(f.api.drafts.size, 1);
});

test("401 同时使会话失效时仍返回重新登录，保留私稿不读取另一账号", async (ctx) => {
  const f = await setup(ctx), sync = f.worker();
  f.api.write = async () => {
    f.changeIdentity({ owner: null, generation: 2, online: false });
    throw new ApiError("authentication_required", "", 401);
  };
  assert.equal((await sync.sync(f.owner, f.key)).state, "login-required");
  assert.ok((await f.repo.load(f.owner, f.key))?.pending);
});


test("双同步器旧读取：另一个已确认的 clean 记录不能再生成多余恢复副本", async (ctx) => {
  const f = await setup(ctx), fast = f.worker();
  await fast.sync(f.owner, f.key);
  const initial = (await f.repo.load(f.owner, f.key))!;
  await f.repo.edit(f.owner, f.key, initial.seq, "合成", "双实例待确认文字");
  let arrived: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = new DraftSynchronizer(f.repo, {
    me: () => f.api.me(), read: async (id) => { const result = await f.api.read(id); arrived(); await gate; return result; },
    write: pending => f.api.write(pending),
  }, () => ({ owner: f.owner, generation: 1, online: true }), randomUUID);
  const late = slow.sync(f.owner, f.key);
  await ready;
  assert.equal((await fast.sync(f.owner, f.key)).state, "saved");
  release();
  assert.equal((await late).state, "saved");
  const final = (await f.repo.load(f.owner, f.key))!;
  assert.equal(f.api.drafts.size, 1);
  assert.equal(final.serverId, initial.serverId);
  assert.equal(final.dirty, false);
});

test("双同步器旧读取：已有恢复与新编辑时不得依据旧身份再恢复一次", async (ctx) => {
  const f = await setup(ctx), fast = f.worker();
  await fast.sync(f.owner, f.key);
  const initial = (await f.repo.load(f.owner, f.key))!;
  await f.repo.edit(f.owner, f.key, initial.seq, "合成", "第一次离线文字");
  let arrived: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = new DraftSynchronizer(f.repo, {
    me: () => f.api.me(), read: async (id) => { const result = await f.api.read(id); arrived(); await gate; return result; },
    write: pending => f.api.write(pending),
  }, () => ({ owner: f.owner, generation: 1, online: true }), randomUUID);
  const late = slow.sync(f.owner, f.key);
  await ready;
  const old = f.api.drafts.get(initial.serverId!)!;
  f.api.drafts.set(old.id, { ...old, revision: old.revision + 1, content: "远端改动" });
  const recovered = await fast.sync(f.owner, f.key);
  assert.equal(recovered.state, "recovered");
  await f.repo.edit(f.owner, f.key, recovered.record!.seq, "合成", "恢复后继续写");
  release();
  assert.equal((await late).state, "pending");
  assert.equal(f.api.drafts.size, 2);
  const pending = (await f.repo.load(f.owner, f.key))!;
  assert.equal(pending.serverId, recovered.record!.serverId);
  assert.equal(pending.dirty, true);
  assert.equal(pending.pending, null);
  assert.equal((await fast.sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.drafts.size, 2);
});


async function editorFixture(ctx: { after(fn: () => void): void }) {
  const f = await setup(ctx);
  const { AuthorizedDrafts } = await import("../src/drafts/authorized.ts");
  const { DraftEditor } = await import("../src/drafts/workspace.ts");
  const { DraftsApi } = await import("../src/drafts/api.ts");
  let current = { drafts: { phase: "online" as "online" | "offline" | "locked", owner: f.owner as string | null }, generation: 1, busy: false };
  const local = new AuthorizedDrafts(async () => f.repo, () => current), worker = f.worker();
  const tools = { local, api: new DraftsApi(async () => { throw new Error("unused_in_editor"); }), current: () => current,
    online: async () => current.drafts.phase === "online", sync: (key: string) => worker.sync(f.owner, key), uuid: randomUUID };
  const editor = new DraftEditor(f.owner, f.key, tools);
  await editor.load();
  return { ...f, local, tools, editor, setIdentity: (value: typeof current) => { current = value; } };
}

test("编辑器：加密暂存期间继续输入，最终落盘最新输入而不反写旧文本", async (ctx) => {
  const f = await editorFixture(ctx);
  const seal = f.cipher.seal.bind(f.cipher);
  let arrived: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  f.cipher.seal = async (...args) => { if (first) { first = false; arrived(); await gate; } return seal(...args); };
  f.editor.input("首次输入", "中文😀");
  await ready;
  f.editor.input("后来输入", "完整的最新文字😀");
  release(); await f.editor.save();
  assert.equal(f.editor.hasUnstored(), false);
  assert.equal(f.editor.snapshot().content, "完整的最新文字😀");
  assert.equal((await f.repo.load(f.owner, f.key))?.content, "完整的最新文字😀");
  assert.equal(f.api.calls.length, 0);
});

test("编辑器：暂存失败保留输入与旧有效记录，重试与提交信号丢失读回", async (ctx) => {
  const f = await editorFixture(ctx);
  f.db.failBeforeCommit = true;
  f.editor.input("失败合成", "不能丢掉的输入");
  await assert.rejects(f.editor.save());
  assert.equal(f.editor.hasUnstored(), true);
  assert.equal(f.editor.snapshot().content, "不能丢掉的输入");
  assert.equal((await f.repo.load(f.owner, f.key))?.content, "首份草稿");
  await f.editor.save();
  assert.equal(f.editor.hasUnstored(), false);
  f.db.failAfterCommit = true;
  f.editor.input("读回合成", "已经提交但回执丢失");
  await f.editor.save();
  assert.equal(f.editor.hasUnstored(), false);
  assert.equal((await f.repo.load(f.owner, f.key))?.content, "已经提交但回执丢失");
});

test("编辑器：服务回执期间新输入不被确认，下一次同步仍只写同一稿", async (ctx) => {
  const f = await editorFixture(ctx);
  const { editorStatus } = await import("../src/drafts/workspace.ts");
  let arrived: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.api.beforeReceipt = async () => { f.api.beforeReceipt = null; arrived(); await gate; };
  const syncing = f.editor.synchronize();
  await ready;
  f.editor.input("新输入", "服务请求之后继续写"); await f.editor.save();
  release(); await syncing;
  assert.equal(f.editor.snapshot().content, "服务请求之后继续写");
  assert.notEqual(editorStatus(f.editor.snapshot()), "已保存到服务器");
  await f.editor.synchronize();
  assert.equal(editorStatus(f.editor.snapshot()), "已保存到服务器");
  assert.equal(f.api.drafts.size, 1);
});

test("编辑器：离线保存、锁定后的迟到输入拒绝，原账号恢复仍保留未存输入", async (ctx) => {
  const f = await editorFixture(ctx);
  f.setIdentity({ drafts: { phase: "offline", owner: f.owner }, generation: 1, busy: false });
  f.editor.input("离线", "离线仍可存"); await f.editor.save();
  await assert.rejects(f.editor.synchronize());
  assert.equal(f.api.calls.length, 0);
  f.db.failBeforeCommit = true;
  f.editor.input("未落盘", "原账号暂存失败的输入"); await assert.rejects(f.editor.save());
  f.setIdentity({ drafts: { phase: "locked", owner: null }, generation: 2, busy: false });
  f.editor.input("迟到", "不得替换");
  assert.equal(f.editor.snapshot().content, "原账号暂存失败的输入");
  await assert.rejects(f.editor.save());
  f.setIdentity({ drafts: { phase: "online", owner: f.owner }, generation: 3, busy: false });
  await f.editor.load(); await f.editor.save();
  assert.equal((await f.local.load(f.key))?.content, "原账号暂存失败的输入");
});

test("编辑器：本机竞争不提升未存输入的基线，明确另存保留双方", async (ctx) => {
  const f = await editorFixture(ctx);
  const initial = f.editor.snapshot().record!;
  await f.repo.edit(f.owner, f.key, initial.seq, "另一编辑器", "另一份已存输入");
  f.editor.input("当前编辑器", "当前未存输入"); await assert.rejects(f.editor.save());
  await assert.rejects(f.editor.load());
  const copy = await f.editor.saveAsCopy();
  assert.notEqual(copy, f.key);
  assert.equal((await f.local.load(f.key))?.content, "另一份已存输入");
  assert.equal((await f.local.load(copy))?.content, "当前未存输入");
});

test("服务器缓存：刷新不能覆盖本机脏稿或未确认请求", async (ctx) => {
  const f = await editorFixture(ctx);
  const serverId = randomUUID(), server = { id: serverId, revision: 1, saved_at: "2026-11-02T00:00:00Z", title: "缓存", content: "初次内容" };
  const cached = await f.local.cacheServer(server);
  await f.local.edit(serverId, cached.seq, "本机修改", "保留的脏稿");
  await f.local.cacheServer({ ...server, revision: 2, content: "服务器新内容" });
  assert.equal((await f.local.load(serverId))?.content, "保留的脏稿");
  assert.equal((await f.local.load(serverId))?.baseRevision, 1);
});


test("自动同步只重试暂时错误，不循环提交缺笔名、错误环境或本机冲突", async () => {
  const { automaticSyncAllowed } = await import("../src/drafts/workspace.ts");
  assert.equal(automaticSyncAllowed(null), true);
  for (const code of ["network", "service_unavailable", "rate_limited"]) assert.equal(automaticSyncAllowed(new ApiError(code)), true);
  for (const code of ["nickname_required", "invalid_input", "environment", "contract", "authentication_required"]) assert.equal(automaticSyncAllowed(new ApiError(code)), false);
  assert.equal(automaticSyncAllowed(new DraftError("local_conflict")), false);
});


const draftReadTransport = (fn: (path: string) => Promise<unknown>) => fn as import("../src/auth/session.ts").Transport;
async function publishingEditor(ctx: { after(fn: () => void): void }) {
  const f = await editorFixture(ctx);
  const { DraftsApi } = await import("../src/drafts/api.ts");
  f.tools.api = new DraftsApi(draftReadTransport(async path => f.api.read(path.split("/").pop()!)));
  await f.editor.synchronize();
  return f;
}

test("发布票据：未同步拒绝；已确认只读核对，路由只含服务器 ID/修订且一次消费", async (ctx) => {
  const f = await editorFixture(ctx);
  assert.equal(f.editor.canPreparePublication(), false);
  await assert.rejects(f.editor.preparePublication());
  assert.equal(f.api.calls.length, 0);
  const { DraftsApi } = await import("../src/drafts/api.ts");
  f.tools.api = new DraftsApi(draftReadTransport(async path => f.api.read(path.split("/").pop()!)));
  await f.editor.synchronize();
  f.setIdentity({ drafts: { phase: "offline", owner: f.owner }, generation: 1, busy: false });
  assert.equal(f.editor.canPreparePublication(), false);
  await assert.rejects(f.editor.preparePublication());
  f.setIdentity({ drafts: { phase: "online", owner: f.owner }, generation: 1, busy: false });
  const before = await f.rows.read(f.owner, f.key), writes = f.api.calls.length;
  const ticket = await f.editor.preparePublication();
  assert.equal(f.editor.publicationPath(ticket), `/publish?draft_id=${ticket.draftId}&source_revision=1`);
  await assert.rejects(async () => f.editor.publicationPath(ticket));
  assert.equal(f.editor.canPreparePublication(), false);
  assert.equal((await f.rows.read(f.owner, f.key))?.revision, before?.revision);
  assert.equal(f.api.calls.length, writes);
  await f.editor.resume();
  assert.equal(f.editor.canPreparePublication(), true);
  assert.equal(f.api.calls.length, writes);
});

test("发布核对期间新输入已暂存也必须拒绝旧票据，不隐式同步/发布", async (ctx) => {
  const f = await publishingEditor(ctx);
  const { DraftsApi } = await import("../src/drafts/api.ts");
  let arrived: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.tools.api = new DraftsApi(draftReadTransport(async path => { const result = await f.api.read(path.split("/").pop()!); arrived(); await gate; return result; }));
  const pending = f.editor.preparePublication(), denied = assert.rejects(pending);
  await ready;
  assert.equal(f.editor.canPreparePublication(), false);
  f.editor.input("新的合成输入", "核对中继续写的内容"); await f.editor.save();
  release(); await denied;
  assert.equal(f.editor.snapshot().content, "核对中继续写的内容");
  assert.equal(f.editor.snapshot().record?.dirty, true);
  assert.equal(f.api.calls.length, 1);
});

test("恢复副本仍 dirty 不进入发布，再确认最新输入后交接新服务器 ID", async (ctx) => {
  const f = await publishingEditor(ctx), initial = f.editor.snapshot().record!;
  const old = f.api.drafts.get(initial.serverId!)!;
  f.api.drafts.set(old.id, { ...old, revision: old.revision + 1, content: "远端新版" });
  f.editor.input("本机合成", "需要恢复的内容"); await f.editor.save();
  let arrived: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.api.beforeReceipt = async () => { f.api.beforeReceipt = null; arrived(); await gate; };
  const syncing = f.editor.synchronize(); await ready;
  f.editor.input("恢复中继续", "副本请求后新增输入"); await f.editor.save();
  release(); await syncing;
  assert.notEqual(f.editor.snapshot().record?.serverId, initial.serverId);
  assert.equal(f.editor.snapshot().record?.dirty, true);
  await assert.rejects(f.editor.preparePublication());
  await f.editor.synchronize();
  const ticket = await f.editor.preparePublication();
  assert.notEqual(ticket.draftId, initial.serverId);
  assert.equal(ticket.draftId, f.editor.snapshot().record?.serverId);
  assert.equal(f.api.drafts.size, 2);
});

test("服务器已到 R2 仍交接已确认 R1，返回只读，不覆盖本机输入或提升基础修订", async (ctx) => {
  const f = await publishingEditor(ctx), initial = f.editor.snapshot().record!;
  const old = f.api.drafts.get(initial.serverId!)!;
  f.api.drafts.set(old.id, { ...old, revision: 2, title: "服务器 R2", content: "不应自动覆盖的新版" });
  const ticket = await f.editor.preparePublication();
  assert.equal(ticket.revision, 1);
  f.editor.publicationPath(ticket);
  await f.editor.resume();
  assert.equal(f.editor.snapshot().record?.baseRevision, 1);
  assert.equal(f.editor.snapshot().content, initial.content);
  assert.equal(f.api.calls.length, 1);
  f.editor.input("返回后新写", "保留的新输入"); await f.editor.save();
  await f.editor.resume();
  assert.equal(f.editor.snapshot().content, "保留的新输入");
  assert.equal(f.editor.snapshot().record?.dirty, true);
  assert.equal(f.api.calls.length, 1);
});

test("票据读取期间换号拒绝；旧票据在输入变化后也不能用于导航", async (ctx) => {
  const f = await publishingEditor(ctx);
  const ticket = await f.editor.preparePublication();
  f.editor.input("后写", "后写内容"); await f.editor.save();
  assert.throws(() => f.editor.publicationPath(ticket));
  await f.editor.synchronize();
  const { DraftsApi } = await import("../src/drafts/api.ts");
  let arrived: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.tools.api = new DraftsApi(draftReadTransport(async path => { const result = await f.api.read(path.split("/").pop()!); arrived(); await gate; return result; }));
  const pending = f.editor.preparePublication(), denied = assert.rejects(pending);
  await ready;
  f.setIdentity({ drafts: { phase: "online", owner: randomUUID() }, generation: 2, busy: false });
  release(); await denied;
  assert.equal(f.editor.canPreparePublication(), false);
});

test("发布核对读失败保留输入，不能自己存一遍或猜最新修订；伪造票据拒绝", async (ctx) => {
  const f = await publishingEditor(ctx), writes = f.api.calls.length;
  const { DraftsApi } = await import("../src/drafts/api.ts");
  f.tools.api = new DraftsApi(async () => { throw new ApiError("network"); });
  await assert.rejects(f.editor.preparePublication());
  assert.equal(f.editor.snapshot().content, "首份草稿");
  assert.equal(f.api.calls.length, writes);
  f.tools.api = new DraftsApi(draftReadTransport(async path => f.api.read(path.split("/").pop()!)));
  const ticket = await f.editor.preparePublication();
  assert.throws(() => f.editor.publicationPath({ ...ticket }));
});


test("返回读取迟到：期间新输入已落盘，也不能将界面回退为旧内容/旧回执", async (ctx) => {
  const f = await publishingEditor(ctx), open = f.cipher.open.bind(f.cipher);
  let arrived: () => void = () => {}, release: () => void = () => {}, first = true;
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.cipher.open = async (...args) => {
    const result = await open(...args);
    if (first) { first = false; arrived(); await gate; }
    return result;
  };
  const returning = f.editor.resume(); await ready;
  f.editor.input("返回后立即输入", "本机已经保存的新文字"); await f.editor.save();
  const seq = f.editor.snapshot().record!.seq;
  release(); await returning;
  assert.equal(f.editor.snapshot().content, "本机已经保存的新文字");
  assert.equal(f.editor.snapshot().record?.seq, seq);
  assert.equal(f.editor.snapshot().record?.dirty, true);
  assert.equal(f.api.calls.length, 1);
});


test("编辑器：另存期间继续输入只写副本，完成切换前排空最新输入", async (ctx) => {
  const f = await editorFixture(ctx), initial = f.editor.snapshot().record!;
  await f.repo.edit(f.owner, f.key, initial.seq, "另一窗口", "原稿已更新");
  f.editor.input("本窗口", "另存开始的输入"); await assert.rejects(f.editor.save());
  const create = f.local.create.bind(f.local), edit = f.local.edit.bind(f.local);
  let arrived: () => void = () => {}, release: () => void = () => {};
  const ready = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writes: string[] = [];
  f.local.create = async (...args) => { const row = await create(...args); arrived(); await gate; return row; };
  f.local.edit = async (...args) => { writes.push(args[0]); return edit(...args); };
  const copying = f.editor.saveAsCopy(); await ready;
  f.editor.input("另存中继续", "最新中文和表情😀");
  const saving = f.editor.save();
  // Attach a rejection handler before releasing the old implementation's CAS failure.
  const settled = Promise.allSettled([copying, saving]);
  await Promise.resolve(); release();
  const results = await settled;
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "fulfilled");
  const copy = (results[0] as PromiseFulfilledResult<string>).value;
  assert.equal(f.editor.localId, copy);
  assert.notEqual(copy, f.key);
  assert.ok(writes.length > 0 && writes.every(key => key === copy));
  assert.equal((await f.local.load(f.key))?.content, "原稿已更新");
  assert.equal((await f.local.load(copy))?.content, "最新中文和表情😀");
  assert.equal(f.editor.hasUnstored(), false);
  assert.equal(f.editor.snapshot().error, null);
  assert.equal(f.api.calls.length, 0);
});

import { chapterDraftsApi } from "../src/novels/chapters/api.ts";
import { ChapterStorage } from "../src/novels/chapters/storage.ts";
import { fixture as chapterFixture } from "./helpers/drafts.ts";
test("N1-B：冲突恢复的新稿继续通过书级入口同步，原稿不覆盖，丢回应不多建章",async ctx=>{
 const f=await chapterFixture();ctx.after(f.close);const owner=randomUUID(),book=randomUUID(),local=randomUUID(),source=randomUUID(),recovered=randomUUID();
 const storage=new ChapterStorage(f.rows,f.cipher),repo=storage.repository(book);await storage.cacheBook(owner,{id:book,title:"同步合成书"});
 await repo.create(owner,local,"初稿","本机新内容");await repo.change(owner,local,row=>({...row!,serverId:source,baseRevision:1}));
 const original={id:source,title:"服务器原章",content:"另一端已保存",revision:2,saved_at:new Date().toISOString()};let receipt:unknown=null,creates=0,drop=true,receivedMutation="";
 const paths:string[]=[];
 const api=chapterDraftsApi(async<T>(path:string,options?:Parameters<import("../src/auth/session.ts").Transport>[1])=>{
  paths.push(path);
  if(path==="/me")return {id:owner,nickname:"章节作者"} as T;
  if(path===`/my/novels/${book}/chapter-drafts/${source}`)return original as T;
  if(path===`/my/novels/${book}/chapter-drafts/recover`){const body=options!.body as {mutation_id:string};if(!receipt){creates++;receivedMutation=body.mutation_id;receipt={draft_id:recovered,revision:1,saved_at:new Date().toISOString()};}else assert.equal(body.mutation_id,receivedMutation);if(drop){drop=false;throw new ApiError("network");}return receipt as T;}
  throw new Error("unexpected_route");
 },book);
 const identity=()=>({owner,generation:1,online:true});
 const first=await new DraftSynchronizer(repo,api,identity,randomUUID).sync(owner,local);assert.equal(first.state,"pending");assert.equal((await repo.load(owner,local))?.pending?.kind,"recover");
 const second=await new DraftSynchronizer(storage.repository(book),api,identity,randomUUID).sync(owner,local);assert.equal(second.state,"recovered");assert.equal(second.record?.serverId,recovered);assert.equal(second.record?.recoveredFrom,source);assert.equal(creates,1);assert.equal(original.content,"另一端已保存");
 assert.equal(paths.some(path=>path.startsWith("/drafts")),false);
});

test("N1-B：已同步章节也不能领取中篇发布票据，原中篇默认能力不变",async ctx=>{
 const f=await editorFixture(ctx);await f.tools.sync(f.key);
 const {DraftEditor}=await import("../src/drafts/workspace.ts");
 const chapter=new DraftEditor(f.owner,f.key,{...f.tools,channel:"chapter"});await chapter.load();
 assert.equal(chapter.canPreparePublication(),false);await assert.rejects(chapter.preparePublication(),e=>e instanceof ApiError&&e.code==="chapter_publication_unavailable");
 await f.editor.load();assert.equal(f.editor.canPreparePublication(),true);
});
