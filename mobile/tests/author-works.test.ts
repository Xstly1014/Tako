import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AuthorWorksApi,
  WorkAction,
  checkedWorkState,
  type WorkState,
} from "../src/api/author-works.ts";
import type { Transport } from "../src/auth/session.ts";
import { ApiError } from "../src/api/client.ts";
import {
  AuthorCatalog,
  emptyCatalogQuery,
  normalizeCatalogQuery,
} from "../src/author-works/catalog.ts";
import type { CatalogPage } from "../src/api/author-works.ts";

test("目录API显式提交条件、取消信号与新摘要校验，旧调用不受影响", async () => {
  const controller = new AbortController();
  let path = "";
  const client = api(async (p, options) => {
    path = p;
    assert.equal(options?.signal, controller.signal);
    return { items: [], next_cursor: "opaque_next" };
  });
  await client.catalog(
    { q: "  A%_\\  ", visibility: "hidden", restriction: "restricted" },
    "",
    controller.signal,
  );
  const params = new URL("http://local" + path).searchParams;
  assert.equal(params.get("q"), "a%_\\");
  assert.equal(params.get("visibility"), "hidden");
  assert.throws(() =>
    normalizeCatalogQuery({ ...emptyCatalogQuery(), q: "😀".repeat(65) }),
  );
  assert.throws(() =>
    normalizeCatalogQuery({ ...emptyCatalogQuery(), q: "bad\n" }),
  );
  assert.equal(
    normalizeCatalogQuery({ ...emptyCatalogQuery(), q: "😀".repeat(64) }).q
      .length,
    128,
  );
  const malformed = api(async () => ({
    items: [{ ...state(), title: "title" }],
    next_cursor: "",
  }));
  await assert.rejects(malformed.catalog(emptyCatalogQuery()), {
    code: "contract",
  });
  await malformed.list();
});

test("全量目录换条件取消迟到响应；分页失败保留游标、去重并拦截循环", async () => {
  const pending: {
    resolve: (page: CatalogPage) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    cursor?: string;
  }[] = [];
  const catalog = new AuthorCatalog(
    {
      catalog: async (_q, cursor, signal) =>
        new Promise((resolve, reject) =>
          pending.push({ resolve, reject, signal, cursor }),
        ),
    },
    () => true,
  );
  const item = {
    ...state(),
    title: "title",
    latest_title: "latest",
    display_limited: false,
  };
  const old = catalog.apply(emptyCatalogQuery());
  const fresh = catalog.apply({ ...emptyCatalogQuery(), q: "new" });
  assert.equal(pending[0].signal?.aborted, true);
  pending[1].resolve({ items: [item], next_cursor: "page2" });
  await fresh;
  pending[0].resolve({ items: [], next_cursor: "" });
  await old;
  assert.equal(catalog.snapshot().page.items.length, 1);
  const failed = catalog.more();
  pending[2].reject(new ApiError("network"));
  await failed;
  assert.equal(catalog.snapshot().page.next_cursor, "page2");
  const retry = catalog.more();
  assert.equal(pending[3].cursor, "page2");
  pending[3].resolve({
    items: [item, { ...item, id: randomUUID() }],
    next_cursor: "page3",
  });
  await retry;
  assert.equal(catalog.snapshot().page.items.length, 2);
  const loop = catalog.more();
  pending[4].resolve({ items: [], next_cursor: "page2" });
  await loop;
  assert.equal((catalog.snapshot().error as ApiError).code, "contract");
  assert.equal(catalog.snapshot().page.next_cursor, "page3");
});

test("管理返回保留条件刷新首屏，切号或退出的迟到私密列表不可写入", async () => {
  let valid = true,
    release!: (page: CatalogPage) => void;
  const calls: string[] = [];
  const catalog = new AuthorCatalog(
    {
      catalog: async (q, cursor) => {
        calls.push(q.visibility + ":" + cursor);
        return { items: [], next_cursor: "" };
      },
    },
    () => valid,
  );
  await catalog.apply({ ...emptyCatalogQuery(), visibility: "hidden" });
  await catalog.refresh();
  assert.deepEqual(calls, ["hidden:", "hidden:"]);
  assert.equal(catalog.snapshot().refreshed, true);
  const stale = new AuthorCatalog(
    {
      catalog: async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    () => valid,
  );
  const request = stale.refresh();
  valid = false;
  stale.cancel();
  release({
    items: [
      {
        ...state(),
        title: "private",
        latest_title: "private",
        display_limited: false,
      },
    ],
    next_cursor: "",
  });
  await request;
  assert.equal(stale.snapshot().page.items.length, 0);
});
const id = randomUUID(),
  draft = randomUUID();
const state = (): WorkState => ({
  id,
  draft_id: draft,
  last_version: 2,
  display_version: 2,
  author_hidden: false,
  history_open: false,
  platform_limited: false,
  state_revision: 1,
});
const api = (
  fn: (path: string, options?: Parameters<Transport>[1]) => Promise<unknown>,
) => new AuthorWorksApi(fn as Transport);
test("管理操作丢响应只重发同一请求，不能插入第二个操作；回执不作现状", async () => {
  const op = new WorkAction(id, () => true, randomUUID),
    calls: unknown[] = [];
  const client = api(async (_path, opts) => {
    calls.push(structuredClone(opts?.body));
    if (calls.length === 1) throw new ApiError("network");
    return { ...state(), state_revision: 2, author_hidden: true };
  });
  const body = op.prepare(state(), "hide");
  await assert.rejects(op.send(body, client));
  assert.equal(op.pending, body);
  assert.throws(() => op.prepare(state(), "set_history", undefined, true));
  await assert.rejects(op.send({ ...body, mutation_id: randomUUID() }, client));
  await op.send(body, client);
  assert.equal(op.pending, null);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls.length, 2);
});
test("并发点击被拒绝，明确冲突释放原请求，未知结果保留", async () => {
  const op = new WorkAction(id, () => true, randomUUID);
  let release!: () => void;
  const waiting = api(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw new ApiError("work_state_conflict", "", 409);
  });
  const body = op.prepare(state(), "hide"),
    first = op.send(body, waiting);
  await assert.rejects(op.send(body, waiting));
  release();
  await assert.rejects(first);
  assert.equal(op.pending, null);
  const next = op.prepare(state(), "set_history", undefined, true);
  await assert.rejects(
    op.send(
      next,
      api(async () => {
        throw new ApiError("service_unavailable", "", 503);
      }),
    ),
  );
  assert.equal(op.pending, next);
});
test("切号或销毁后不能提交，迟到回执不能确认旧账号操作", async () => {
  let current = true,
    calls = 0,
    release!: () => void;
  const op = new WorkAction(id, () => current, randomUUID),
    body = op.prepare(state(), "hide");
  const pending = op.send(
    body,
    api(async () => {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return state();
    }),
  );
  current = false;
  release();
  await assert.rejects(
    pending,
    (e: unknown) => e instanceof ApiError && e.code === "stale_session",
  );
  await assert.rejects(
    op.send(
      body,
      api(async () => {
        calls++;
        return state();
      }),
    ),
  );
  op.dispose();
  current = true;
  assert.throws(() => op.prepare(state(), "hide"));
  assert.equal(calls, 1);
});
test("只构造与动作相符的字段，作品限制阻止恢复或切版，恢复默认不回退", () => {
  const op = new WorkAction(id, () => true, randomUUID);
  assert.equal(op.prepare(state(), "restore").version, undefined);
  assert.equal(op.prepare(state(), "restore", 1).version, 1);
  assert.equal(
    op.prepare(state(), "set_history", undefined, true).history_open,
    true,
  );
  assert.equal(op.prepare(state(), "hide", 1, true).version, undefined);
  assert.throws(() => op.prepare(state(), "switch_display", 3));
  assert.throws(() =>
    op.prepare({ ...state(), platform_limited: true }, "restore"),
  );
  assert.throws(() => op.prepare({ ...state(), id: randomUUID() }, "hide"));
});
test("API 拒绝错误归属、重复分页、畸形正文；本人版本走私有接口", async () => {
  assert.throws(() => checkedWorkState({ ...state(), display_version: 3 }));
  const client = api(async () => ({ items: [], next_cursor: id }));
  await assert.rejects(client.list(id));
  const timeline = {
    state: { ...state(), id: randomUUID() },
    versions: [],
    events: [],
    next_version_before: 0,
    next_event_before: 0,
  };
  await assert.rejects(api(async () => timeline).timeline(id));
  const paths: string[] = [];
  await assert.rejects(
    api(async (path) => {
      paths.push(path);
      return { id, version: 1 };
    }).version(id, 1),
  );
  assert.deepEqual(paths, [`/my/works/${id}/versions/1`]);
});
