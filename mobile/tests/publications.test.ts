import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PublicationsApi,
  checkedPreview,
  type Preview,
} from "../src/api/publications.ts";
import { PublicationFlow, type JournalStore } from "../src/publication/flow.ts";
import type { Transport } from "../src/auth/session.ts";
import { ApiError } from "../src/api/client.ts";
const account = randomUUID(),
  draft = randomUUID(),
  previewId = randomUUID(),
  workId = randomUUID();
const preview = (): Preview => ({
  id: previewId,
  draft_id: draft,
  source_revision: 1,
  expected_version: 0,
  title: "固定标题",
  content: "固定正文",
  introduction: "简介",
  tags: ["日常"],
  created_at: "2026-11-02T00:00:00Z",
  expires_at: "2026-11-03T00:00:00Z",
});
const result = () => ({
  work_id: workId,
  version: 1,
  published_at: "2026-11-02T00:00:00Z",
  review_status: "pending" as const,
});
const api = (
  fn: (path: string, options?: Parameters<Transport>[1]) => Promise<unknown>,
) => new PublicationsApi(fn as Transport);
function vault() {
  let value: string | null = null,
    broken = false;
  return {
    get: async () => value,
    set: async (v: string) => {
      if (broken) throw Error("storage");
      value = v;
    },
    remove: async () => {
      value = null;
    },
    value: () => value,
    fail: () => {
      broken = true;
    },
  };
}
function flow(
  client: PublicationsApi,
  store: JournalStore = vault(),
  valid = () => true,
  clock = () => Date.parse("2026-11-02T01:00:00Z"),
) {
  return new PublicationFlow(client, store, account, valid, randomUUID, clock);
}
test("预览必须授权且锁定服务器修订；丢响应沿原请求不读取新正文", async () => {
  const requests: unknown[] = [];
  const f = flow(
    api(async (_path, options) => {
      requests.push(structuredClone(options?.body));
      if (requests.length === 1) throw new ApiError("network");
      return preview();
    }),
  );
  await f.restore();
  await assert.rejects(f.prepare(draft, 1, "简介", ["日常"], false));
  assert.equal(requests.length, 0);
  await assert.rejects(f.prepare(draft, 1, "简介", ["日常"], true));
  await f.prepare(draft, 2, "新简介", ["幻想"], true);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(f.preview?.source_revision, 1);
  assert.equal(f.result, null);
});
test("发布先保留最小标识；存储失败不发 HTTP，正文与标题不进记录", async () => {
  const store = vault();
  let posts = 0;
  const f = flow(
    api(async (path) => {
      if (path === "/publication-previews") return preview();
      posts++;
      return result();
    }),
    store,
  );
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  store.fail();
  await assert.rejects(
    f.publish(),
    (e: unknown) => e instanceof ApiError && e.code === "storage",
  );
  assert.equal(posts, 0);
});
test("关闭重开只读取原预览，原请求重试唯一；确认记录不含正文或密码", async () => {
  const store = vault();
  let published = false,
    posts = 0;
  const client = api(async (path, options) => {
    if (path === "/publication-previews") return preview();
    if (path.startsWith("/publication-previews/"))
      return { ...preview(), ...(published ? { published: result() } : {}) };
    posts++;
    published = true;
    throw new ApiError("network");
  });
  const f = flow(client, store);
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  const saved = store.value()!;
  assert.ok(saved.includes(previewId));
  assert.ok(!saved.includes("固定"));
  assert.ok(!saved.includes("简介"));
  const reopened = flow(client, store);
  await reopened.restore();
  assert.equal(posts, 1);
  assert.deepEqual(reopened.result, result());
  await assert.rejects(reopened.publish());
  await reopened.reset();
  assert.equal(store.value(), null);
});
test("过期预览不提交；发布未知后的重试不被本机时间阻断", async () => {
  let now = Date.parse("2026-11-02T00:00:00Z"),
    calls = 0;
  const client = api(async (path) => {
    if (path === "/publication-previews") return preview();
    calls++;
    if (calls === 1) throw new ApiError("network");
    return result();
  });
  const f = flow(
    client,
    vault(),
    () => true,
    () => now,
  );
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  now = Date.parse("2026-11-04T00:00:00Z");
  await f.publish();
  assert.equal(calls, 2);
  const g = flow(
    client,
    vault(),
    () => true,
    () => now,
  );
  await g.restore();
  await g.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(g.publish());
  assert.equal(calls, 2);
});
test("账号切换与迟到结果不回填；损坏或跨账号记录拒绝恢复并保留", async () => {
  let current = true,
    release!: () => void;
  const f = flow(
    api(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return preview();
    }),
    vault(),
    () => current,
  );
  await f.restore();
  const pending = f.prepare(draft, 1, "简介", ["日常"], true);
  current = false;
  release();
  await assert.rejects(pending);
  assert.equal(f.preview, null);
  const store = vault();
  await store.set(JSON.stringify({ v: 1, account_id: randomUUID() }));
  const g = flow(
    api(async () => {
      throw Error("must_not_request");
    }),
    store,
  );
  await assert.rejects(g.restore());
  assert.ok(store.value());
});
test("错误预览身份和错版回执拒绝；明确冲突不自动生成新预览", async () => {
  assert.throws(() =>
    checkedPreview(
      { ...preview(), draft_id: randomUUID() },
      { draft_id: draft, source_revision: 1 },
    ),
  );
  const store = vault();
  const f = flow(
    api(async (path) =>
      path === "/publication-previews"
        ? preview()
        : Promise.reject(new ApiError("publication_conflict", "", 409)),
    ),
    store,
  );
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  assert.equal(f.pendingPublish, null);
  assert.equal(store.value(), null);
  assert.equal(f.preview?.id, previewId);
  await f.reset();
  assert.equal(f.preview, null);
});
test("同账号多个页面不覆盖待确认记录，旧页面确认不能清掉新请求", async () => {
  const store = vault();
  let release!: () => void,
    hold = true;
  const client = api(async (path) => {
    if (path === "/publication-previews") return preview();
    if (path.startsWith("/publication-previews/"))
      return { ...preview(), published: result() };
    if (hold) {
      hold = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return result();
  });
  const a = flow(client, store),
    b = flow(client, store);
  await a.restore();
  await b.restore();
  await a.prepare(draft, 1, "简介", ["日常"], true);
  await b.prepare(draft, 1, "简介", ["日常"], true);
  const first = a.publish();
  await Promise.resolve();
  await Promise.resolve();
  await assert.rejects(b.publish());
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await first;
  const saved = store.value();
  await assert.rejects(
    b.publish(),
    (e: unknown) =>
      e instanceof ApiError && e.code === "another_publication_pending",
  );
  assert.equal(store.value(), saved);
  await b.restore();
  await a.reset();
  const c = flow(client, store);
  await c.restore();
  await c.prepare(draft, 1, "简介", ["日常"], true);
  await c.publish();
  const next = store.value();
  await assert.rejects(b.reset());
  assert.equal(store.value(), next);
});
test("服务器确认过期才清理原标识；错误恢复元数据使发布保持锁定", async () => {
  const store = vault();
  let posts = 0;
  const base = api(async (path) => {
    if (path === "/publication-previews") return preview();
    posts++;
    throw new ApiError("network");
  });
  const f = flow(base, store);
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  const saved = store.value()!;
  const wrong = flow(
    api(async () => ({ ...preview(), expected_version: 1 })),
    store,
  );
  await assert.rejects(wrong.restore());
  await assert.rejects(wrong.publish());
  assert.equal(store.value(), saved);
  const expired = flow(
    api(async () => {
      throw new ApiError("preview_expired", "", 410);
    }),
    store,
  );
  await assert.rejects(expired.restore());
  assert.equal(store.value(), null);
  assert.equal(posts, 1);
});
test("发布未知后会话失效仍保留标识，原账号重登只读确认", async () => {
  const store = vault();
  let posts = 0;
  const client = api(async (path) => {
    if (path === "/publication-previews") return preview();
    if (path.startsWith("/publication-previews/"))
      return { ...preview(), published: result() };
    posts++;
    throw new ApiError(
      posts === 1 ? "network" : "authentication_required",
      "",
      posts === 1 ? 0 : 401,
    );
  });
  const f = flow(client, store);
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  const saved = store.value();
  await assert.rejects(f.publish());
  assert.equal(store.value(), saved);
  const restored = flow(client, store);
  await restored.restore();
  assert.equal(restored.result?.version, 1);
  assert.equal(posts, 2);
});
