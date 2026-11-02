import test from "node:test";
import assert from "node:assert/strict";
import { isTimeline, mergeVersions, readVersion, timeline } from "../src/api/versions.ts";
import { ReaderError } from "../src/api/reader.ts";

const id = "00000000-0000-0000-0000-000000000001";
const node = (version: number) => ({ version, published_at: "2026-11-02T00:00:00Z", is_current: version === 2, readable: true });
const page = { history_open: true, versions: [node(2), node(1)], events: [], next_version_before: 0, next_event_before: 0 };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "X-Tako-Environment": "test" },
});

test("时间线守卫拒绝非法日期、重复节点和畸形权限，合并不补齐缺号", () => {
  assert.equal(isTimeline(page), true);
  assert.equal(isTimeline({ ...page, versions: [node(1), node(1)] }), false);
  assert.equal(isTimeline({ ...page, versions: [{ ...node(1), published_at: "bad" }] }), false);
  assert.equal(isTimeline({ ...page, versions: [{ ...node(1), readable: "true" }] }), false);
  assert.deepEqual(mergeVersions([node(4)], [node(2), node(4)]).map((x) => x.version), [2, 4]);
});

test("历史阅读不信任响应身份；指定版本、作品必须匹配", async (ctx) => {
  const body = { id, version: 2, title: "合成", content: "合成正文", introduction: "", tags: [], author_nickname: "合成", published_at: "2026-11-02T00:00:00Z" };
  ctx.mock.method(globalThis, "fetch", async () => response(body));
  assert.equal((await readVersion(id, 2)).version, 2);
  await assert.rejects(readVersion(id, 1), (e: unknown) => e instanceof ReaderError && e.kind === "contract");
  ctx.mock.restoreAll();
  ctx.mock.method(globalThis, "fetch", async () => response({ ...body, id: "00000000-0000-0000-0000-000000000002" }));
  await assert.rejects(readVersion(id, 2), (e: unknown) => e instanceof ReaderError && e.kind === "contract");
});

test("非法版本不发请求；分页游标停滞不当成可继续分页", async (ctx) => {
  let count = 0;
  ctx.mock.method(globalThis, "fetch", async () => { count++; return response(page); });
  await assert.rejects(readVersion(id, NaN));
  await assert.rejects(readVersion(id, 0));
  await assert.rejects(readVersion("bad", 1));
  await assert.rejects(timeline(id, -1));
  assert.equal(count, 0);
  await assert.rejects(timeline(id, 2), (e: unknown) => e instanceof ReaderError && e.kind === "contract");
});

test("关闭授权或受限的 404、断网不伪装成空时间线", async (ctx) => {
  ctx.mock.method(globalThis, "fetch", async () => response({ error: "resource_not_found" }, 404));
  await assert.rejects(readVersion(id, 1), (e: unknown) => e instanceof ReaderError && e.kind === "unavailable");
  await assert.rejects(timeline(id), (e: unknown) => e instanceof ReaderError && e.kind === "unavailable");
  ctx.mock.restoreAll();
  ctx.mock.method(globalThis, "fetch", async () => { throw new TypeError("offline"); });
  await assert.rejects(timeline(id), (e: unknown) => e instanceof ReaderError && e.kind === "network");
});
