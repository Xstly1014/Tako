import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Session } from "../src/auth/session.ts";
import { request, ApiError } from "../src/api/client.ts";
import { community } from "../src/api/reader.ts";
import { DraftsApi } from "../src/drafts/api.ts";
import { DraftSynchronizer } from "../src/drafts/sync.ts";
import { DraftRepository } from "../src/drafts/storage.ts";
import { createDraftSessionVault } from "../src/drafts/access.ts";
import { AuthorizedDrafts } from "../src/drafts/authorized.ts";
import { fixture } from "./helpers/drafts.ts";

test("真实 3300 + 本机 SQLite：冻结请求重开确认、已有服务端新版保留并另存", async (ctx) => {
  await community("", "");
  const f = await fixture(); ctx.after(f.close);
  let secureValue: string | null = null;
  const item = { get: async () => secureValue, set: async (v: string) => { secureValue = v; }, remove: async () => { secureValue = null; } };
  const session = new Session(createDraftSessionVault(item), request);
  const guarded = new AuthorizedDrafts(async () => f.repo, session.snapshot);
  await session.restore();
  await session.signIn("register", `draft-core-${randomUUID()}@example.test`, randomUUID());
  try {
    await session.setNickname("原生私稿核心合成验收");
    const owner = session.snapshot().account!.id, key = randomUUID();
    await assert.rejects(guarded.list());
    await session.confirmDraftAccess();
    const api = new DraftsApi((path, options) => session.authorized(path, options));
    let drop = true;
    const transport = { me: () => api.me(), read: (id: string) => api.read(id), write: async (pending: Parameters<typeof api.write>[0]) => {
      const result = await api.write(pending);
      if (drop) { drop = false; throw new ApiError("network"); }
      return result;
    } };
    const identity = () => ({ owner: session.snapshot().drafts.owner, generation: session.snapshot().generation, online: session.snapshot().drafts.phase === "online" });
    await guarded.create(key, "合成核心稿", "本机原始合成文字");
    const offline = new Session(createDraftSessionVault(item), async () => { throw new ApiError("network"); });
    await offline.restore();
    const offlineDrafts = new AuthorizedDrafts(async () => f.repo, offline.snapshot);
    assert.equal((await offlineDrafts.load(key))?.owner, owner);
    await assert.rejects(offline.authorized("/drafts"));
    assert.equal((await new DraftSynchronizer(f.repo, transport, identity, randomUUID).sync(owner, key)).state, "pending");
    const uncertain = (await f.repo.load(owner, key))!;
    assert.ok(uncertain.pending);
    const reopened = new DraftRepository(f.rows, f.cipher), worker = new DraftSynchronizer(reopened, transport, identity, randomUUID);
    assert.equal((await worker.sync(owner, key)).state, "saved");
    assert.equal((await api.list()).items.length, 1);
    const original = (await f.repo.load(owner, key))!;
    await session.authorized("/drafts/save", { method: "POST", body: { mutation_id: randomUUID(), draft_id: original.serverId,
      base_revision: original.baseRevision, title: "服务端合成稿", content: "电脑先保存的合成文字" } });
    await guarded.edit(key, original.seq, "手机合成稿", "手机离线新增的合成文字");
    const recovered = await worker.sync(owner, key);
    assert.equal(recovered.state, "recovered");
    assert.notEqual(recovered.record?.serverId, original.serverId);
    assert.ok((await api.read(original.serverId!)).content === "电脑先保存的合成文字");
    assert.ok((await api.read(recovered.record!.serverId!)).content === "手机离线新增的合成文字");
    assert.equal((await api.list()).items.length, 2);
  } finally { await session.logout(); }
  const loggedOut = new Session(createDraftSessionVault(item), async () => { throw new ApiError("network"); });
  await loggedOut.restore();
  await assert.rejects(new AuthorizedDrafts(async () => f.repo, loggedOut.snapshot).list());
});


test("真实编辑器链路：本机缓存既有稿、编辑同步、再打开保持服务器确认内容", async (ctx) => {
  const { DraftEditor } = await import("../src/drafts/workspace.ts");
  const f = await fixture(); ctx.after(f.close);
  let value: string | null = null;
  const item = { get: async () => value, set: async (v: string) => { value = v; }, remove: async () => { value = null; } };
  const session = new Session(createDraftSessionVault(item), request);
  await session.restore();
  await session.signIn("register", `draft-editor-${randomUUID()}@example.test`, randomUUID());
  try {
    await session.setNickname("编辑器合成验收"); await session.confirmDraftAccess();
    const owner = session.snapshot().account!.id, local = new AuthorizedDrafts(async () => f.repo, session.snapshot);
    const api = new DraftsApi((path, options) => session.authorized(path, options));
    const worker = new DraftSynchronizer(f.repo, api, () => ({ owner: session.snapshot().drafts.owner,
      generation: session.snapshot().generation, online: session.snapshot().drafts.phase === "online" }), randomUUID);
    const tools = { local, api, current: session.snapshot, online: () => session.reconnectDrafts(),
      sync: (key: string) => worker.sync(owner, key), uuid: randomUUID };
    const key = randomUUID(); await local.create(key);
    const editor = new DraftEditor(owner, key, tools); await editor.load();
    editor.input("真实编辑合成标题", "中文、表情😀和多行\n都是合成验收文字。"); await editor.save();
    await editor.synchronize();
    const record = editor.snapshot().record!;
    assert.equal(record.dirty, false); assert.equal(record.pending, null);
    const server = await api.read(record.serverId!);
    assert.equal(server.content, editor.snapshot().content);
    // Import of an existing server draft initializes a clean local copy.
    const cached = await local.cacheServer(server);
    const reopened = new DraftEditor(owner, cached.id, tools); await reopened.load();
    assert.equal(reopened.snapshot().content, server.content);
    reopened.input("继续合成", "再次保存的合成文字"); await reopened.save(); await reopened.synchronize();
    assert.equal((await api.read(record.serverId!)).content, "再次保存的合成文字");
    assert.equal((await api.list()).items.length, 1);
    const { PublicationsApi, publicationInput } = await import("../src/api/publications.ts");
    const { PublicationFlow } = await import("../src/publication/flow.ts");
    const { work } = await import("../src/api/reader.ts");
    const ticket = await reopened.preparePublication();
    const path = new URL(reopened.publicationPath(ticket), "https://fixture.invalid");
    const input = publicationInput({ draft_id: path.searchParams.get("draft_id"), source_revision: path.searchParams.get("source_revision") });
    assert.equal(input.revision, reopened.snapshot().record!.baseRevision);
    let journal: string | null = null;
    const store = { get: async () => journal, set: async (v: string) => { journal = v; }, remove: async () => { journal = null; } };
    const flow = new PublicationFlow(new PublicationsApi((path, options) => session.authorized(path, options)), store,
      owner, () => session.snapshot().phase === "ready" && session.snapshot().account?.id === owner, randomUUID);
    await flow.restore();
    await flow.prepare(input.draftId, input.revision, "C1-C 合成链路", ["日常"], true);
    assert.equal(flow.preview?.content, "再次保存的合成文字");
    await flow.publish();
    const workId = flow.result!.work_id;
    try {
      assert.equal((await work(workId)).content, "再次保存的合成文字");
      const before = await f.rows.read(owner, reopened.localId);
      await reopened.resume();
      assert.equal((await f.rows.read(owner, reopened.localId))?.revision, before?.revision);
      assert.equal(reopened.snapshot().content, "再次保存的合成文字");
    } finally {
      const { AuthorWorksApi } = await import("../src/api/author-works.ts");
      const author = new AuthorWorksApi((path, options) => session.authorized(path, options));
      const state = await new PublicationsApi((path, options) => session.authorized(path, options)).state(workId, ticket.draftId);
      await author.change(workId, { action: "hide", expected_state_revision: state.state_revision, mutation_id: randomUUID() });
    }
  } finally { await session.logout(); }
});
