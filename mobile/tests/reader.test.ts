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
