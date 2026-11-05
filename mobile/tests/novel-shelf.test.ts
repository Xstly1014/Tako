import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "../src/api/client.ts";
import {
  NovelShelfApi,
  checkedShelfState,
  checkedShelfReceipt,
  type ShelfReceipt,
  type ShelfState,
  type ShelfWrite,
  type ShelfPage,
} from "../src/novels/shelf-api.ts";
const book = randomUUID(),
  time = "2026-11-05T00:00:00Z";
const input: ShelfWrite = {
  mutation_id: randomUUID(),
  base_revision: 0,
  operation: "join",
};
const state: ShelfState = {
  novel_id: book,
  in_shelf: true,
  following: true,
  revision: 1,
  generation: 1,
  added_at: time,
  updated_at: time,
};
const receipt: ShelfReceipt = {
  mutation_id: input.mutation_id,
  operation: "join",
  state,
  accepted_at: time,
};
test("书架原回执绑定作品操作修订，客户端不自动重发POST", async () => {
  const calls: { method?: string; path: string }[] = [];
  const api = new NovelShelfApi(async <T>(path: string, o?: { method?: string }) => {
    calls.push({ path, method: o?.method });
    return receipt as T;
  });
  assert.equal((await api.write(book, input)).state.generation, 1);
  await api.receipt(book, input);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["POST", undefined],
  );
  assert.match(calls[1].path, /requests/);
  for (const bad of [
    { ...receipt, mutation_id: randomUUID() },
    { ...receipt, operation: "remove" },
    { ...receipt, state: { ...state, novel_id: randomUUID() } },
    { ...receipt, state: { ...state, revision: 2 } },
    { ...receipt, state: { ...state, following: false } },
    { ...receipt, content: "私稿不允许进入回执" },
  ])
    assert.throws(
      () => checkedShelfReceipt(bad as ShelfReceipt, book, input),
      ApiError,
    );
  await assert.rejects(
    api.write(book, { ...input, owner_id: randomUUID() } as ShelfWrite),
    ApiError,
  );
  assert.equal(calls.length, 2);
});
test("书架空关系与墓碑区分，矛盾关系和伪造字段被拒绝", () => {
  assert.equal(
    checkedShelfState({
      ...state,
      in_shelf: false,
      following: false,
      revision: 0,
      generation: 0,
      added_at: null,
      updated_at: null,
    }).revision,
    0,
  );
  assert.equal(
    checkedShelfState({ ...state, in_shelf: false, following: false }).revision,
    1,
  );
  for (const bad of [
    { ...state, in_shelf: false },
    { ...state, generation: 2 },
    { ...state, revision: 0 },
    { ...state, added_at: null },
    { ...state, start_sequence: 99 },
    { ...state, revision: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.throws(() => checkedShelfState(bad as ShelfState), ApiError);
});
test("书架不可读占位不泄漏标题，分页拒错书与重复条目", async () => {
  let value: ShelfPage = {
    items: [{ relation: state, book: null }],
    next_cursor: "",
  };
  const api = new NovelShelfApi(async <T>() => value as T);
  assert.equal((await api.list()).items[0].book, null);
  value = {
    items: [
      { relation: state, book: null },
      { relation: state, book: null },
    ],
    next_cursor: "",
  };
  await assert.rejects(api.list(), ApiError);
  value = {
    items: [
      { relation: { ...state, in_shelf: false, following: false }, book: null },
    ],
    next_cursor: "",
  };
  await assert.rejects(api.list(), ApiError);
  value = {
    items: [
      {
        relation: state,
        book: {
          id: randomUUID(),
          title: "合成",
          introduction: "",
          tags: ["日常"],
          author: "作者",
          completed: false,
          chapter_count: 1,
          first_published_at: time,
          latest_chapter_published_at: time,
        },
      },
    ],
    next_cursor: "",
  };
  await assert.rejects(api.list(), ApiError);
});
