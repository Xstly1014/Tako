import test from "node:test";
import assert from "node:assert/strict";
import {
  community,
  isPage,
  isWork,
  mergeWorks,
  read,
  ReaderError,
  work,
} from "../src/api/reader.ts";

test("真实测试 API：分页、筛选与匿名正文，未授权访问不混入私密数据", async () => {
  const first = await community("", "");
  assert.ok(isPage(first));
  assert.ok(first.items.length > 0);
  assert.ok(first.next_cursor);
  const second = await community("", first.next_cursor);
  assert.equal(
    mergeWorks(first.items, second.items).length,
    first.items.length + second.items.length,
  );
  const tag = first.tags[0].name;
  const filtered = await community(tag, "");
  assert.ok(filtered.items.every((item) => item.tags.includes(tag)));
  const body = await work(first.items[0].id);
  assert.ok(isWork(body));
  assert.equal(body.id, first.items[0].id);
  await assert.rejects(
    work("not-an-id"),
    (error: unknown) =>
      error instanceof ReaderError && error.kind === "unavailable",
  );
  await assert.rejects(
    work("00000000-0000-0000-0000-000000000001"),
    (error: unknown) =>
      error instanceof ReaderError && error.kind === "unavailable",
  );
});

test("错误环境、服务故障和畸形响应不会被当成空列表", async (ctx) => {
  const examples = [
    { status: 200, env: "production", body: {}, kind: "environment" },
    {
      status: 503,
      env: "test",
      body: { error: "unavailable" },
      kind: "service",
    },
    {
      status: 404,
      env: "test",
      body: { error: "not_found" },
      kind: "unavailable",
    },
    { status: 200, env: "test", body: { items: [] }, kind: "contract" },
  ];
  for (const example of examples) {
    ctx.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(JSON.stringify(example.body), {
          status: example.status,
          headers: {
            "X-Tako-Environment": example.env,
            "X-Request-ID": "00000000-0000-0000-0000-000000000001",
          },
        }),
    );
    await assert.rejects(
      read("/community", isPage),
      (error: unknown) =>
        error instanceof ReaderError && error.kind === example.kind,
    );
    ctx.mock.restoreAll();
  }
});

test("断网与取消不伪装成没有作品；匿名请求不发送 Cookie", async (ctx) => {
  ctx.mock.method(
    globalThis,
    "fetch",
    async (_: unknown, options: RequestInit) => {
      assert.equal(options.credentials, "omit");
      assert.ok(options.signal);
      throw new TypeError("offline");
    },
  );
  await assert.rejects(
    read("/community", isPage),
    (error: unknown) =>
      error instanceof ReaderError && error.kind === "network",
  );
  ctx.mock.restoreAll();
  ctx.mock.method(
    globalThis,
    "fetch",
    async (_: unknown, options: RequestInit) => {
      assert.equal(options.signal?.aborted, true);
      throw new DOMException("aborted", "AbortError");
    },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    read("/community", isPage, controller.signal),
    (error: unknown) =>
      error instanceof ReaderError && error.kind === "network",
  );
});

test("JSON 损坏按服务响应异常处理，保留请求编号", async (ctx) => {
  ctx.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("<html>gateway failure</html>", {
        status: 200,
        headers: {
          "X-Tako-Environment": "test",
          "X-Request-ID": "00000000-0000-0000-0000-000000000001",
        },
      }),
  );
  await assert.rejects(
    read("/community", isPage),
    (error: unknown) =>
      error instanceof ReaderError &&
      error.kind === "contract" &&
      error.requestId === "00000000-0000-0000-0000-000000000001",
  );
});

test("分页重复内容不产生重复行；空数组是合法空列表", async () => {
  const page = await community("", "");
  assert.equal(mergeWorks(page.items, page.items).length, page.items.length);
  assert.equal(
    isPage({ items: [], featured: [], tags: [], next_cursor: "" }),
    true,
  );
  assert.equal(
    isPage({
      items: [{ id: "broken" }],
      featured: [],
      tags: [],
      next_cursor: "",
    }),
    false,
  );
});

// Public search is part of the existing reader client gate, including its pure
// request coordination. No new unclassified test file or skipped service case.
import {
  searchWorks,
  isSearchPage,
  searchQuery,
  type SearchPage,
} from "../src/api/search.ts";
import { SearchFlow } from "../src/search/flow.ts";
const searchCard = (suffix = "1") => ({
  id: `11111111-1111-4111-8111-${suffix.padStart(12, "0")}`,
  version: 1,
  title: "合成星海",
  introduction: "合成简介",
  tags: ["幻想"],
  author_nickname: "合成作者",
  first_published_at: "2026-11-02T00:00:00Z",
});
function held<T>() {
  let release!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    release = yes;
    reject = no;
  });
  return { promise, release, reject };
}
test("搜索客户端：字面编码、匿名请求和合法空结果；不接受正文或坏卡片", async (ctx) => {
  ctx.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/api/search");
      assert.equal(parsed.searchParams.get("q"), "中文%_!\\ABC");
      assert.equal(parsed.searchParams.get("cursor"), "safe-cursor");
      assert.equal(options.credentials, "omit");
      assert.equal(new Headers(options.headers).has("Authorization"), false);
      return new Response(JSON.stringify({ items: [], next_cursor: "" }), {
        headers: { "X-Tako-Environment": "test" },
      });
    },
  );
  assert.deepEqual(await searchWorks(" 中文%_!\\ABC ", "safe-cursor"), {
    items: [],
    next_cursor: "",
  });
  assert.equal(isSearchPage({ items: [searchCard()], next_cursor: "" }), true);
  for (const value of [
    { items: [{ ...searchCard(), content: "private" }], next_cursor: "" },
    { items: Array.from({ length: 13 }, () => searchCard()), next_cursor: "" },
    { items: [{ ...searchCard(), tags: [] }], next_cursor: "" },
    { items: [], next_cursor: "x".repeat(513) },
    { items: [], next_cursor: "", content: "private" },
  ])
    assert.equal(isSearchPage(value), false);
  assert.equal(searchQuery("😀".repeat(64)), "😀".repeat(64));
  for (const q of [
    " ",
    "字".repeat(65),
    "\n词",
    "a\tb",
    String.fromCharCode(0xd800),
  ])
    assert.equal(searchQuery(q), null);
});
test("搜索客户端：错误环境、服务故障和不合约不能成为零结果", async (ctx) => {
  for (const [status, env, body, kind] of [
    [200, "production", { items: [], next_cursor: "" }, "environment"],
    [503, "test", { error: "service_unavailable" }, "service"],
    [200, "test", { items: [] }, "contract"],
  ] as const) {
    ctx.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "X-Tako-Environment": env },
        }),
    );
    await assert.rejects(
      searchWorks("合成"),
      (e: unknown) => e instanceof ReaderError && e.kind === kind,
    );
    ctx.mock.restoreAll();
  }
});
test("搜索协调：只在明确提交时发送，同词重复提交不重入", async () => {
  let calls = 0;
  const pending = held<SearchPage>();
  const flow = new SearchFlow(async () => {
    calls++;
    return pending.promise;
  });
  flow.input("合成");
  assert.equal(calls, 0);
  const first = flow.submit();
  await flow.submit();
  assert.equal(calls, 1);
  pending.release({ items: [searchCard()], next_cursor: "next" });
  await first;
  assert.equal(flow.snapshot().items.length, 1);
  assert.equal(flow.snapshot().loading, false);
  flow.input("另一个未提交词");
  assert.equal(flow.canMore(), false);
  await flow.more();
  assert.equal(calls, 1);
});
test("搜索协调：换词取消旧请求，迟到成功/失败不能覆盖新结果或结束新加载", async () => {
  const a = held<SearchPage>(),
    b = held<SearchPage>();
  let oldSignal: AbortSignal | undefined;
  const flow = new SearchFlow(async (q, _c, signal) => {
    if (q === "A") {
      oldSignal = signal;
      return a.promise;
    }
    return b.promise;
  });
  flow.input("A");
  const first = flow.submit();
  flow.input("B");
  const second = flow.submit();
  assert.equal(oldSignal?.aborted, true);
  a.release({ items: [searchCard("1")], next_cursor: "old" });
  await first;
  assert.equal(flow.snapshot().loading, true);
  assert.equal(flow.snapshot().items.length, 0);
  b.release({ items: [searchCard("2")], next_cursor: "" });
  await second;
  assert.equal(flow.snapshot().items[0].id, searchCard("2").id);
  const late = held<SearchPage>();
  const other = new SearchFlow(async () => late.promise);
  other.input("A");
  const request = other.submit();
  other.clear();
  late.reject(new Error("late"));
  await request;
  assert.equal(other.snapshot().query, "");
  assert.equal(other.snapshot().error, null);
});
test("搜索协调：分页保留已读结果，失败原游标重试去重并拒绝循环游标", async () => {
  let calls = 0;
  const cursors: string[] = [];
  const flow = new SearchFlow(async (_q, cursor) => {
    calls++;
    cursors.push(cursor ?? "");
    if (calls === 1) return { items: [searchCard("1")], next_cursor: "next" };
    if (calls === 2) throw new ReaderError("network");
    if (calls === 3)
      return { items: [searchCard("1"), searchCard("2")], next_cursor: "last" };
    return { items: [], next_cursor: "last" };
  });
  flow.input("合成");
  await flow.submit();
  await flow.more();
  assert.equal(flow.snapshot().items.length, 1);
  assert.ok(flow.snapshot().moreError);
  await flow.more();
  assert.equal(flow.snapshot().items.length, 2);
  assert.deepEqual(cursors, ["", "next", "next"]);
  await flow.more();
  assert.ok(flow.snapshot().moreError);
  assert.equal(flow.snapshot().cursor, "last");
});
test("搜索协调：新搜索和清除隔离迟到分页；离页取消不持久化搜索", async () => {
  const pending = held<SearchPage>();
  let n = 0;
  const flow = new SearchFlow(async (_q, c) =>
    c
      ? pending.promise
      : { items: [searchCard(String(++n))], next_cursor: "next" },
  );
  flow.input("A");
  await flow.submit();
  const more = flow.more();
  flow.input("B");
  await flow.submit();
  pending.release({ items: [searchCard("9")], next_cursor: "" });
  await more;
  assert.deepEqual(
    flow.snapshot().items.map((x) => x.id),
    [searchCard("2").id],
  );
  assert.equal(flow.snapshot().moreLoading, false);
  flow.dispose();
  const reopened = new SearchFlow();
  assert.equal(reopened.snapshot().query, "");
});


test("真实测试 API：公开中篇搜索客户端和现有发现入口一致", async () => {
  const discovery = await community("", "");
  const first = discovery.items[0];
  const q = Array.from(first.title).slice(0, 24).join("").trim();
  assert.ok(q);
  const results = await searchWorks(q);
  assert.ok(isSearchPage(results));
  assert.ok(results.items.some(item => item.id === first.id));
  await assert.rejects(searchWorks(q, "bad-cursor"), (error: unknown) => error instanceof ReaderError && error.kind === "service");
});
