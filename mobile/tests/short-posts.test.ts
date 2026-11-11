import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api/client.ts";
import {
  listShortPostVersions,
  readShortPost,
  shortPostFeed,
  shortPostImageUri,
} from "../src/api/short-posts.ts";

const post = "00000000-0000-4000-8000-000000000001";
const image = "00000000-0000-4000-8000-000000000002";
const readA = "00000000-0000-4000-8000-000000000003";
const readB = "00000000-0000-4000-8000-000000000004";
const publishedAt = "2026-11-11T00:00:00Z";
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "X-Tako-Environment": "test" } });
const expectCode = (code: string) =>
  (error: unknown) => error instanceof ApiError && error.code === code;

test("短帖分页保留游标并拒绝重复游标及无效媒体", async ({ mock }) => {
  const fetch = mock.method(globalThis, "fetch", async () => json({
    items: [{ id: post, title: "短帖", excerpt: "合成正文", author: "测试作者", published_at: publishedAt, version: 1, cover: null }],
    next_cursor: post,
  }));
  assert.equal((await shortPostFeed()).next_cursor, post);
  await assert.rejects(shortPostFeed(post), expectCode("contract"));
  assert.match(String(fetch.mock.calls[1].arguments[0]), /\/short-posts\?cursor=/);
  fetch.mock.mockImplementation(async () => json({
    items: [{ id: post, title: "短帖", excerpt: "合成正文", author: "测试作者", published_at: publishedAt, version: 1 }],
    next_cursor: "",
  }));
  await assert.rejects(shortPostFeed(), expectCode("contract"));
});

test("短帖详情拒绝错配的版本并尊重服务端拒绝读取", async ({ mock }) => {
  const snapshot = {
    id: post, version: 2, title: "短帖", content: "合成正文", author: "测试作者",
    published_at: publishedAt, images: [], novel: null,
  };
  const fetch = mock.method(globalThis, "fetch", async () => json(snapshot));
  assert.equal((await readShortPost(post)).version, 2);
  await assert.rejects(readShortPost(post, 1), expectCode("contract"));
  assert.match(String(fetch.mock.calls[1].arguments[0]), /\/versions\/1$/);
  fetch.mock.mockImplementation(async () => json({ error: "resource_not_found" }, 404));
  await assert.rejects(readShortPost(post, 1), expectCode("resource_not_found"));
});

test("历史记录只接受向较早版本翻页，图片地址按版本和本次读取隔离", async ({ mock }) => {
  mock.method(globalThis, "fetch", async () =>
    json([{ version: 2, published_at: publishedAt, readable: false }]));
  assert.equal((await listShortPostVersions(post, 3))[0].readable, false);
  await assert.rejects(listShortPostVersions(post, 2), expectCode("contract"));
  const first = shortPostImageUri(post, 2, image, readA);
  assert.match(first, /\/versions\/2\/images\//);
  assert.notEqual(first, shortPostImageUri(post, 2, image, readB));
  assert.throws(() => shortPostImageUri(post, 0, image, readA), expectCode("contract"));
});
