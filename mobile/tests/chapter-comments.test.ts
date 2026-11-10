import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ChapterCommentsApi,
  checkedChapterComments,
  type ChapterComment,
} from "../src/novels/comments-api.ts";
const book = randomUUID(),
  chapter = randomUUID(),
  author = randomUUID(),
  comment = randomUUID();
const row: ChapterComment = {
  id: comment,
  novel_id: book,
  chapter_id: chapter,
  author_id: author,
  nickname: "读者",
  root_id: null,
  reply_to: null,
  reply_name: "",
  content: "章讨论",
  sequence: 5,
  revision: 1,
  replies: 0,
  can_delete: false,
  created_at: "2026-11-05T00:00:00Z",
  deleted: false,
  blocked: false,
  reason: "",
};
test("章评论严格绑定书章与根，拒绝私密字段和隐藏正文投影", () => {
  const check = (r: unknown) =>
    checkedChapterComments({ items: [r], next: 0 }, { book, chapter });
  assert.equal(check(row).items[0].id, comment);
  for (const r of [
    { ...row, chapter_id: randomUUID() },
    { ...row, novel_id: randomUUID() },
    { ...row, content_version: 1 },
    { ...row, blocked: true },
    { ...row, reason: "他人私密原因" },
    { ...row, root_id: randomUUID() },
    { ...row, deleted: true },
  ])
    assert.throws(() => check(r));
  assert.equal(
    checkedChapterComments(
      { items: [{ ...row, blocked: true, reason: "本人原因" }], next: 0 },
      undefined,
      true,
    ).items[0].reason,
    "本人原因",
  );
});
test("回复页只接受目标根与正向序列，不接循环游标", async () => {
  const root = randomUUID();
  const api = new ChapterCommentsApi(
    async () =>
      ({
        items: [{ ...row, root_id: root, reply_to: root, sequence: 3 }],
        next: 0,
      }) as never,
  );
  await assert.rejects(() => api.list(book, chapter, 4, root));
  await assert.rejects(() => api.list(book, chapter, 0, randomUUID()));
});
test("删除原请求绑定评论，普通客户端不暴露运营动作", async () => {
  let count = 0;
  const input = {
    mutation_id: randomUUID(),
    expected_account_id: author,
    expected_revision: 1,
    action: "delete" as const,
    reason: "",
  };
  const api = new ChapterCommentsApi(async (p, o) => {
    count++;
    assert.equal(p, `/chapter-comments/${comment}/actions`);
    assert.equal(o?.body, input);
    return { id: comment, revision: 2, state: "deleted" } as never;
  });
  await api.act(comment, input);
  await api.act(comment, input);
  assert.equal(count, 2);
  await assert.rejects(() => api.act(comment, { ...input, action: "block" }));
  assert.equal(count, 2);
  const wrong = new ChapterCommentsApi(
    async () => ({ id: randomUUID(), revision: 2, state: "deleted" }) as never,
  );
  await assert.rejects(() => wrong.act(comment, input));
});
test("作者管理结果不得混入另一部小说，删除正文不得复现", async () => {
  const api = new ChapterCommentsApi(
    async () =>
      ({ items: [{ ...row, novel_id: randomUUID() }], next: 0 }) as never,
  );
  await assert.rejects(() => api.forAuthor(book));
  assert.throws(() =>
    checkedChapterComments(
      { items: [{ ...row, deleted: true }], next: 0 },
      undefined,
      true,
    ),
  );
});

test("写回执必须匹配发表或删除动作，不接其他状态", async () => {
  const create = {
    mutation_id: randomUUID(),
    expected_account_id: author,
    context: "signed",
    content: "合成",
  };
  const api = new ChapterCommentsApi(
    async () => ({ id: comment, revision: 1, state: "blocked" }) as never,
  );
  await assert.rejects(() => api.create(book, chapter, create));
  await assert.rejects(() =>
    api.act(comment, {
      mutation_id: randomUUID(),
      expected_account_id: author,
      expected_revision: 1,
      action: "delete",
      reason: "",
    }),
  );
});
