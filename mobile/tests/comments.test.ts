import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CommentEditor } from "../src/comments/editor.ts";
import { ApiError } from "../src/api/client.ts";
import {
  CommentsApi,
  checkedComments,
  type CommentCreate,
} from "../src/api/comments.ts";
import type { Transport } from "../src/auth/session.ts";
const a = randomUUID(),
  b = randomUUID(),
  comment = randomUUID();
const published = { id: comment, revision: 1, state: "published" as const };
function editor() {
  const e = new CommentEditor(randomUUID);
  e.syncAccount(a);
  return e;
}
test("游客文字必须确认带入；登录和恢复都不自动发表", () => {
  const e = new CommentEditor(randomUUID);
  e.edit("游客想法");
  e.syncAccount(a);
  assert.equal(e.snapshot().text, "");
  assert.equal(e.snapshot().prompt, "guest");
  assert.throws(() => e.edit("覆盖"));
  e.confirmInput(true);
  assert.equal(e.snapshot().text, "游客想法");
  assert.equal(e.snapshot().unconfirmed, false);
});
test("拒绝游客带入即清空；新账号不能看到原账号输入", () => {
  const e = new CommentEditor(randomUUID);
  e.edit("游客");
  e.syncAccount(a);
  e.confirmInput(false);
  assert.equal(e.snapshot().hasInput, false);
  e.edit("账号甲");
  e.replyTo(comment);
  e.syncAccount(b);
  assert.equal(e.snapshot().text, "");
  assert.equal(e.snapshot().replyTo, null);
});
test("未确认重试使用原请求，即使传入新的阅读上下文也不重建", async () => {
  const e = editor();
  e.edit("正文");
  let first: CommentCreate | undefined;
  await assert.rejects(
    e.submit("context-1", async (body) => {
      first = body;
      throw new ApiError("network");
    }),
  );
  assert.equal(e.snapshot().text, "正文");
  assert.throws(() => e.edit("改写"));
  await e.submit("context-2", async (body) => {
    assert.deepEqual(body, first);
    return published;
  });
  assert.equal(e.snapshot().hasInput, false);
});
test("限频/目标消失失败保留文字和对象，可由用户修改后重新提交", async () => {
  const e = editor();
  e.edit("回复");
  e.replyTo(comment);
  await assert.rejects(
    e.submit("ctx", async () => {
      throw new ApiError("comment_conflict", "", 409);
    }),
  );
  assert.equal(e.snapshot().unconfirmed, false);
  assert.equal(e.snapshot().replyTo, comment);
  e.replyTo(null);
  e.edit("主评论");
  assert.equal(e.snapshot().text, "主评论");
});
test("过期账号锁定输入，同账号重登主动恢复原请求", async () => {
  const e = editor();
  e.edit("保留");
  let mutation = "";
  await assert.rejects(
    e.submit("ctx", async (body) => {
      mutation = body.mutation_id;
      throw new ApiError("authentication_required", "", 401);
    }),
  );
  assert.equal(e.snapshot().text, "");
  e.syncAccount(a);
  assert.equal(e.snapshot().prompt, "same-account");
  e.confirmInput(true);
  await e.submit("new", async (body) => {
    assert.equal(body.mutation_id, mutation);
    return published;
  });
});
test("旧响应迟到不能清空新账号文字", async () => {
  const e = editor();
  e.edit("甲");
  let finish = (_: typeof published) => {};
  const sent = e.submit(
    "ctx",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const rejected = assert.rejects(
    sent,
    (err: unknown) => err instanceof ApiError && err.code === "stale_session",
  );
  e.syncAccount(b);
  e.edit("乙");
  finish(published);
  await rejected;
  assert.equal(e.snapshot().text, "乙");
});
test("关闭页面销毁输入，新实例不恢复；销毁后禁止提交", async () => {
  const e = editor();
  e.edit("临时");
  e.dispose();
  assert.equal(e.snapshot().hasInput, false);
  await assert.rejects(e.submit("ctx", async () => published));
  assert.equal(editor().snapshot().text, "");
});
test("Unicode 按字符计数，空白无效，超过 1000 字不提交", async () => {
  const e = editor();
  let calls = 0;
  e.edit(" ");
  await assert.rejects(
    e.submit("ctx", async () => {
      calls++;
      return published;
    }),
  );
  e.edit("😀".repeat(1001));
  await assert.rejects(
    e.submit("ctx", async () => {
      calls++;
      return published;
    }),
  );
  assert.equal(calls, 0);
  e.edit("  " + "😀".repeat(1000) + "  ");
  await e.submit("ctx", async () => published);
});
test("提交锁阻止重复点击；畸形成功响应仍属于未确认", async () => {
  const e = editor();
  e.edit("测试");
  let fail = (_: unknown) => {};
  const pending = e.submit(
    "ctx",
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const rejected = assert.rejects(pending);
  await assert.rejects(e.submit("ctx", async () => published));
  fail(new ApiError("network"));
  await rejected;
  await assert.rejects(e.submit("ctx", async () => ({}) as typeof published));
  assert.equal(e.snapshot().unconfirmed, true);
});
test("API 拒绝损坏分页和错误讨论范围，不将异常当成空列表", async () => {
  assert.throws(() => checkedComments({ items: [], next: -1 }));
  assert.throws(() => checkedComments({ items: [{}], next: 0 }));
  const api = new CommentsApi((async () => ({
    items: [],
    next: 0,
  })) as Transport);
  await assert.rejects(api.list("invalid"));
  await assert.rejects(api.list(a, -1));
  await assert.rejects(
    api.remove(comment, {
      mutation_id: randomUUID(),
      expected_account_id: a,
      expected_revision: 1,
      action: "block",
      reason: "",
    }),
  );
});

test("服务器错发另一作品或另一根评论的回复时拒绝展示", async () => {
  const entry = {
    id: comment,
    work_id: b,
    author_id: a,
    nickname: "测试",
    root_id: null,
    reply_to: null,
    reply_name: "",
    content: "文字",
    sequence: 1,
    revision: 1,
    replies: 0,
    can_delete: false,
    created_at: "2026-11-02T00:00:00Z",
    deleted: false,
    blocked: false,
    reason: "",
  };
  const api = new CommentsApi((async () => ({
    items: [entry],
    next: 0,
  })) as Transport);
  await assert.rejects(
    api.list(a),
    (e: unknown) => e instanceof ApiError && e.code === "contract",
  );
  entry.work_id = a;
  await assert.rejects(
    api.list(a, 0, comment),
    (e: unknown) => e instanceof ApiError && e.code === "contract",
  );
});
