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
