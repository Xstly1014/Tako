import { useSyncExternalStore } from "react";
import { Session } from "../../mobile/src/auth/session.ts";
import { ApiError } from "../../mobile/src/api/client.ts";
export const work = "11111111-1111-4111-8111-111111111111";
const a = "22222222-2222-4222-8222-222222222222",
  b = "33333333-3333-4333-8333-333333333333";
let stored = null,
  seq = 2,
  failNext = false;
const rows = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    work_id: work,
    author_id: b,
    nickname: "示例作者",
    root_id: null,
    reply_to: null,
    reply_name: "",
    content: "已有主评论正文",
    sequence: 1,
    revision: 1,
    replies: 0,
    can_delete: false,
    created_at: "2026-11-02T00:00:00Z",
    deleted: false,
    blocked: false,
    reason: "",
  },
];
const receipts = new Map();
let attempts = 0,
  unique = 0;
const account = (token) => (token?.endsWith("b".repeat(64)) ? b : a);
export function page(cursor = 0, root = null, viewer = null) {
  return {
    items: rows
      .filter(
        (x) =>
          !x.deleted &&
          !x.blocked &&
          x.root_id === root &&
          (!cursor || x.sequence < cursor),
      )
      .map((x) => ({ ...x, can_delete: x.author_id === viewer })),
    next: 0,
  };
}
const transport = async (path, options = {}) => {
  const { body, token } = options,
    viewer = account(token);
  if (path === "/app/auth/login" || path === "/app/auth/register") {
    const id = body.email.startsWith("b@") ? b : a;
    return {
      account: { id, nickname: id === a ? "" : "乙" },
      access_token: "tako_app_" + (id === a ? "a" : "b").repeat(64),
      token_type: "Bearer",
      expires_in: 604800,
    };
  }
  if (path === "/app/auth/logout") return;
  if (path === "/me")
    return {
      id: viewer,
      nickname: body?.nickname ?? (viewer === a ? "甲" : "乙"),
    };
  const url = new URL("http://fixture" + path);
  if (options.method === "POST" && path.endsWith("/comments")) {
    attempts++;
    if (body.expected_account_id !== viewer)
      throw new ApiError("invalid_input", "", 400);
    const old = receipts.get(body.mutation_id);
    if (old) return old;
    const root = body.reply_to
      ? (rows.find((x) => x.id === body.reply_to)?.root_id ?? body.reply_to)
      : null;
    const row = {
      id: crypto.randomUUID(),
      work_id: work,
      author_id: viewer,
      nickname: viewer === a ? "甲" : "乙",
      root_id: root,
      reply_to: body.reply_to,
      reply_name: root ? "示例作者" : "",
      content: body.content,
      sequence: seq++,
      revision: 1,
      replies: 0,
      can_delete: true,
      created_at: "2026-11-02T00:00:00Z",
      deleted: false,
      blocked: false,
      reason: "",
    };
    rows.unshift(row);
    const result = { id: row.id, revision: 1, state: "published" };
    receipts.set(body.mutation_id, result);
    unique++;
    if (failNext) {
      failNext = false;
      throw new ApiError("network");
    }
    return result;
  }
  if (options.method === "POST" && path.endsWith("/actions")) {
    const id = path.split("/")[2],
      row = rows.find((x) => x.id === id);
    if (!row || row.author_id !== viewer)
      throw new ApiError("invalid_input", "", 400);
    const old = receipts.get(body.mutation_id);
    if (old) return old;
    rows
      .filter((x) => x.id === id || x.root_id === id)
      .forEach((x) => {
        x.deleted = true;
        x.content = "";
        x.revision++;
      });
    const result = { id, revision: row.revision, state: "deleted" };
    receipts.set(body.mutation_id, result);
    return result;
  }
  if (url.pathname === "/my/comments")
    return {
      items: rows.filter((x) => x.author_id === viewer).map((x) => ({ ...x })),
      next: 0,
    };
  if (url.pathname.endsWith("/comments"))
    return page(
      Number(url.searchParams.get("cursor")),
      url.searchParams.get("root"),
      viewer,
    );
  throw new ApiError("resource_not_found", "", 404);
};
export const session = new Session(
  {
    get: async () => stored,
    set: async (value) => {
      stored = value;
    },
    remove: async () => {
      stored = null;
    },
  },
  transport,
);
export function useSession() {
  return {
    session,
    ...useSyncExternalStore(session.subscribe, session.snapshot),
  };
}
window.componentTest = {
  page,
  stats: () => ({ attempts, unique }),
  dropNext: () => {
    failNext = true;
  },
  privateReason: () => {
    const row = rows.find((x) => x.author_id === a);
    row.reason = "仅甲可见";
  },
  switchB: async () => {
    await session.logout();
    await session.signIn("login", "b@example.test", "fixture-password");
  },
  session,
};
