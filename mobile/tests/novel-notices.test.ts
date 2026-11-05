import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "../src/api/client.ts";
import {
  NovelNoticesApi,
  checkedNotice,
  type NovelNotice,
  type NoticeDetail,
  type NoticeRead,
  type NoticePage,
} from "../src/novels/notices-api.ts";
const id = randomUUID(),
  book = randomUUID(),
  chapter = randomUUID(),
  time = "2026-11-05T00:00:00Z";
const notice: NovelNotice = {
  id,
  novel_id: book,
  created_at: time,
  read_at: null,
  readable_chapters: 1,
  book: {
    id: book,
    title: "真实引用合成书",
    introduction: "",
    tags: ["日常"],
    author: "作者",
    completed: false,
    chapter_count: 2,
    first_published_at: time,
    latest_chapter_published_at: time,
  },
};
test("消息只接动态安全引用，错误归属和隐藏内容投影被拒绝", () => {
  assert.equal(
    checkedNotice({ ...notice, book: null, readable_chapters: 0 }).book,
    null,
  );
  for (const value of [
    { ...notice, book: null },
    { ...notice, novel_id: randomUUID() },
    { ...notice, read_at: "invalid" },
    { ...notice, readable_chapters: 3 },
    { ...notice, content: "不允许进入通知的正文" },
    { ...notice, owner_id: randomUUID() },
  ])
    assert.throws(() => checkedNotice(value as NovelNotice), ApiError);
  assert.throws(() => checkedNotice(notice, randomUUID()), ApiError);
});
test("消息详情拒错目标、不可读旧标题和无权限条目，分页保持有界", async () => {
  let value: NoticeDetail = {
    notice,
    items: [{ id: chapter, ordinal: 1, readable: true, title: "章节" }],
    next_cursor: "",
  };
  const api = new NovelNoticesApi(async <T>() => value as T);
  assert.equal((await api.detail(id)).items.length, 1);
  value = {
    ...value,
    items: [{ id: chapter, ordinal: 1, readable: false, title: "泄漏旧标题" }],
  };
  await assert.rejects(api.detail(id), ApiError);
  value = {
    ...value,
    notice: { ...notice, book: null, readable_chapters: 0 },
    items: [{ id: chapter, ordinal: 1, readable: false, title: null }],
  };
  await assert.rejects(api.detail(id), ApiError);
  value = {
    ...value,
    notice,
    items: [
      { id: chapter, ordinal: 1, readable: true, title: "章节" },
      { id: chapter, ordinal: 2, readable: true, title: "重复" },
    ],
  };
  await assert.rejects(api.detail(id), ApiError);
  value = { ...value, items: [], notice: { ...notice, id: randomUUID() } };
  await assert.rejects(api.detail(id), ApiError);
});
test("标记已读是同资源幂等操作，可重试且不带位置/账号或新标识", async () => {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  const ack: NoticeRead = { id, read_at: time };
  const api = new NovelNoticesApi(
    async <T>(path: string, o?: { method?: string; body?: unknown }) => {
      calls.push({ path, ...o });
      return ack as T;
    },
  );
  assert.deepEqual(await api.read(id), await api.read(id));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, calls[1].path);
  assert.deepEqual(
    calls.map((i) => i.body),
    [{}, {}],
  );
  const wrong = new NovelNoticesApi(
    async <T>() => ({ ...ack, id: randomUUID() }) as T,
  );
  await assert.rejects(wrong.read(id), ApiError);
});
test("消息列表拒绝重复和游标循环，不把不可信内容交给页面", async () => {
  let value: NoticePage = { items: [notice], next_cursor: "" };
  const api = new NovelNoticesApi(async <T>() => value as T);
  assert.equal((await api.list()).items.length, 1);
  value = { items: [notice, notice], next_cursor: "" };
  await assert.rejects(api.list(), ApiError);
  value = { items: [], next_cursor: "same" };
  await assert.rejects(api.list("same"), ApiError);
});
