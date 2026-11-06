import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chapterPanelApi } from "../src/novels/comment-panel-api.ts";
const book = randomUUID(),
  chapter = randomUUID(),
  comment = randomUUID(),
  owner = randomUUID();
test("章评论面板适配只规范本地主题，不把章伪装为中篇HTTP", async () => {
  const calls: string[] = [];
  const api = chapterPanelApi(
    async (path) => {
      calls.push(path);
      return {
        items: [
          {
            id: comment,
            novel_id: book,
            chapter_id: chapter,
            author_id: owner,
            nickname: "读者",
            root_id: null,
            reply_to: null,
            reply_name: "",
            content: "测试",
            sequence: 1,
            revision: 1,
            replies: 0,
            can_delete: true,
            created_at: "2026-11-06T00:00:00Z",
            deleted: false,
            blocked: false,
            reason: "",
          },
        ],
        next: 0,
      } as never;
    },
    book,
    chapter,
  );
  const page = await api.list(chapter);
  assert.equal(page.items[0].work_id, chapter);
  assert.equal(
    calls[0],
    `/novels/${book}/chapters/${chapter}/comments?cursor=0`,
  );
  assert.equal("novel_id" in page.items[0], false);
  await assert.rejects(() => api.list(randomUUID()));
  assert.equal(calls.length, 1);
});
test("发表保留原载荷与标识，错误主题不会发请求", async () => {
  const body = {
    mutation_id: randomUUID(),
    expected_account_id: owner,
    content: "输入",
    context: "signed",
  };
  let calls = 0;
  const api = chapterPanelApi(
    async (path, options) => {
      calls++;
      assert.equal(path, `/novels/${book}/chapters/${chapter}/comments`);
      assert.equal(options?.body, body);
      return { id: comment, revision: 1, state: "published" } as never;
    },
    book,
    chapter,
  );
  await api.create(chapter, body);
  await api.create(chapter, body);
  assert.equal(calls, 2);
  await assert.rejects(() => api.create(book, body));
  assert.equal(calls, 2);
});
