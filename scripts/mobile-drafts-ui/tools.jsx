import { session } from "./context.jsx";
import { DraftRepository } from "../../mobile/src/drafts/storage.ts";
import { AuthorizedDrafts } from "../../mobile/src/drafts/authorized.ts";
import { DraftSynchronizer } from "../../mobile/src/drafts/sync.ts";
import { DraftsApi } from "../../mobile/src/drafts/api.ts";
import { ApiError } from "../../mobile/src/api/client.ts";
const rows = new Map(); let queue = Promise.resolve();
const store = { read: async (o, id) => rows.get(o + "/" + id) ?? null,
  ids: async o => [...rows.keys()].filter(k => k.startsWith(o + "/")).map(k => k.split("/")[1]),
  update(o, id, transform) {
    const result = queue.then(async () => { const row = await transform(rows.get(o + "/" + id) ?? null);
      if (window.draftUi.failStore) throw new Error("injected"); rows.set(o + "/" + id, row); });
    queue = result.catch(() => undefined); return result;
  } };
const keys = new Map();
const cipher = {
  async seal(owner, context, plain, allowNew) {
    if (!keys.has(owner)) { if (!allowNew) throw new Error("missing_key"); keys.set(owner, await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])); }
    const iv = crypto.getRandomValues(new Uint8Array(12)), bytes = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) }, keys.get(owner), new TextEncoder().encode(plain)));
    return btoa(String.fromCharCode(...iv, ...bytes));
  },
  async open(owner, context, text) {
    const data = Uint8Array.from(atob(text), c => c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12), additionalData: new TextEncoder().encode(context) }, keys.get(owner), data.slice(12)));
  },
};
const repo = new DraftRepository(store, cipher), server = new Map(), receipts = new Map();
const revisions = new Map(), previews = new Map(), works = new Map();
export async function fixtureHttp(path, options) {
  if (path === "/me") return session.snapshot().account;
  if (path === "/drafts" || path.startsWith("/drafts?")) return { items: [...server.values()].map(x => ({ ...x, created_at: x.saved_at, recovered_from: null })), next_cursor: "" };
  if (path.startsWith("/my/works/")) return works.get(path.split("/").pop());
  if (path === "/publication-previews" && options?.method === "POST") {
    window.draftUi.previewPosts = (window.draftUi.previewPosts ?? 0) + 1;
    const body = options.body, source = revisions.get(body.draft_id + "/" + body.source_revision);
    if (!source) throw new ApiError("source_revision_unavailable", "", 409);
    const result = { id: crypto.randomUUID(), draft_id: source.id, source_revision: source.revision,
      title: source.title, content: source.content, introduction: body.introduction, tags: body.tags,
      expected_version: 0, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), published: null };
    previews.set(result.id, result); return result;
  }
  if (path.startsWith("/publication-previews/")) return previews.get(path.split("/").pop());
  if (path === "/publications") {
    window.draftUi.publicationPosts = (window.draftUi.publicationPosts ?? 0) + 1;
    const preview = previews.get(options.body.preview_id);
    if (!preview.published) {
      const id = crypto.randomUUID(); preview.published = { work_id: id, version: 1, published_at: new Date().toISOString(), review_status: "pending" };
      works.set(id, { id, draft_id: preview.draft_id, title: preview.title, display_version: 1, last_version: 1,
        state_revision: 1, author_hidden: false, history_open: false, platform_limited: false });
    }
    return preview.published;
  }
  if (options?.method !== "POST") {
    if (path.startsWith("/drafts/")) {
      window.draftUi.sourceReads = (window.draftUi.sourceReads ?? 0) + 1;
      if (window.draftUi.failReadOnce) { window.draftUi.failReadOnce = false; throw new ApiError("network"); }
    }
    return server.get(path.split("/").pop());
  }
  window.draftUi.posts = (window.draftUi.posts ?? 0) + 1;
  const body = options.body, kind = path.split("/").pop();
  let result = receipts.get(body.mutation_id);
  if (!result) {
    const old = server.get(body.draft_id);
    if (kind === "save" && old?.revision !== body.base_revision) throw new ApiError("revision_conflict", "", 409);
    const id = kind === "save" ? body.draft_id : crypto.randomUUID();
    result = { draft_id: id, revision: kind === "save" ? old.revision + 1 : 1, saved_at: new Date().toISOString() };
    server.set(id, { id, title: body.title, content: body.content, revision: result.revision, saved_at: result.saved_at });
    revisions.set(id + "/" + result.revision, { ...server.get(id) });
    receipts.set(body.mutation_id, result);
  }
  if (window.draftUi.drop) { window.draftUi.drop = false; throw new ApiError("network"); }
  return result;
}
const api = new DraftsApi(fixtureHttp);
export function advanceServer(id) {
  const old = server.get(id), next = { ...old, revision: old.revision + 1, content: "服务器另存的新版，不覆盖本机输入" };
  server.set(id, next); revisions.set(id + "/" + next.revision, { ...next });
}
const worker = new DraftSynchronizer(repo, api, () => ({ owner: session.snapshot().drafts.owner, generation: session.snapshot().generation, online: session.snapshot().drafts.phase === "online" }), () => crypto.randomUUID());
const tools = { local: new AuthorizedDrafts(async () => repo, session.snapshot), api, current: session.snapshot,
  online: async () => window.draftUi.online && await session.reconnectDrafts(), sync: id => worker.sync(session.snapshot().drafts.owner, id), uuid: () => crypto.randomUUID() };
export const nativeDraftTools = () => tools;
