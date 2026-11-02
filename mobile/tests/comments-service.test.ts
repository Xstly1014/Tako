import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request, ApiError } from "../src/api/client.ts";
import { Session } from "../src/auth/session.ts";
import { community, work } from "../src/api/reader.ts";
import { CommentsApi } from "../src/api/comments.ts";
import { CommentEditor } from "../src/comments/editor.ts";
test("真实 3300：注册读者、主评论与回复、丢响应重试唯一、删除根评论删整串", async () => {
  // Environment is checked before creating a synthetic account. No mail is sent.
  const page = await community("", "");
  assert.ok(page.items.length);
  let token: string | null = null;
  const session = new Session(
    {
      get: async () => token,
      set: async (value) => {
        token = value;
      },
      remove: async () => {
        token = null;
      },
    },
    request,
  );
  await session.restore();
  await session.signIn(
    "register",
    `comment-${randomUUID()}@example.test`,
    randomUUID(),
  );
  const api = new CommentsApi((path, options) =>
    session.authorized(path, options),
  );
  let root: string | undefined,
    revision = 1;
  try {
    await session.setNickname("App评论自动验收");
    const account = session.snapshot().account!;
    const reading = await work(page.items[0].id);
    assert.ok(reading.comment_context);
    const editor = new CommentEditor(randomUUID);
    editor.syncAccount(account.id);
    editor.edit("合成主评论 " + randomUUID());
    const result = await editor.submit(reading.comment_context, (body) =>
      api.create(reading.id, body),
    );
    root = result.id;
    revision = result.revision;
    const reply = new CommentEditor(randomUUID);
    reply.syncAccount(account.id);
    reply.edit("合成回复 " + randomUUID());
    reply.replyTo(root);
    await assert.rejects(
      reply.submit(reading.comment_context, async (body) => {
        await api.create(reading.id, body);
        throw new ApiError("network");
      }),
    );
    const receipt = await reply.submit(reading.comment_context, (body) =>
      api.create(reading.id, body),
    );
    const replies = await api.list(reading.id, 0, root);
    assert.equal(replies.items.length, 1);
    assert.equal(replies.items[0].id, receipt.id);
    assert.equal(replies.items[0].can_delete, true);
    const removed = await api.remove(root, {
      mutation_id: randomUUID(),
      expected_account_id: account.id,
      expected_revision: revision,
      action: "delete",
      reason: "",
    });
    assert.equal(removed.state, "deleted");
    const mine = await api.mine();
    const tombstones = mine.items.filter(
      (x) => x.id === root || x.id === receipt.id,
    );
    assert.equal(tombstones.length, 2);
    assert.ok(tombstones.every((x) => x.deleted && x.content === ""));
    await assert.rejects(
      api.list(reading.id, 0, root),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
    assert.equal(
      (await api.list(reading.id)).items.some((x) => x.id === root),
      false,
    );
    root = undefined;
  } finally {
    if (root)
      await api.remove(root, {
        mutation_id: randomUUID(),
        expected_account_id: session.snapshot().account!.id,
        expected_revision: revision,
        action: "delete",
        reason: "",
      });
    await session.logout();
  }
});
