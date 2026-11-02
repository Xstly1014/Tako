import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { components } from "../src/api/contract";
import { request } from "../src/api/client.ts";
import { ReaderError, community, work } from "../src/api/reader.ts";
import { readVersion, timeline } from "../src/api/versions.ts";
import { Session } from "../src/auth/session.ts";
import { CommentsApi } from "../src/api/comments.ts";

function session() {
  let token: string | null = null;
  return new Session({ get: async () => token, set: async (v) => { token = v; }, remove: async () => { token = null; } }, request);
}
test("真实 3300：多版本授权、旧上下文评论、受限节点过滤与隐藏新访问", async () => {
  await community("", ""); // Environment guard before credentials or synthetic writes.
  const env = Object.fromEntries((await readFile(new URL("../../.runtime/local-test/.env", import.meta.url), "utf8"))
    .split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
      const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)];
    }));
  assert.ok(env.TEST_OPERATOR_PASSWORD, "Dedicated local test operator configuration required");
  const author = session(), operator = session();
  let id = "";
  await author.restore(); await operator.restore();
  try {
    await author.signIn("register", `version-${randomUUID()}@example.test`, randomUUID());
    await author.setNickname("版本阅读合成验收");
    await operator.signIn("login", "operator@tako-test.invalid", env.TEST_OPERATOR_PASSWORD);
    const saved = await author.authorized<components["schemas"]["WriteResult"]>("/drafts/create", {
      method: "POST", body: { mutation_id: randomUUID(), title: "合成版本一", content: "合成故事第一版，仅用于验证 App 历史阅读，不是真实用户作品。" },
    });
    const publish = async (revision: number) => {
      const preview = await author.authorized<components["schemas"]["PublicationPreview"]>("/publication-previews", {
        method: "POST", body: { mutation_id: randomUUID(), draft_id: saved.draft_id, source_revision: revision,
          introduction: "自动化版本阅读验收", tags: ["日常"], rights_confirmed: true },
      });
      const result = await author.authorized<components["schemas"]["PublicationResult"]>("/publications", {
        method: "POST", body: { mutation_id: randomUUID(), preview_id: preview.id, expected_version: preview.expected_version },
      });
      id = result.work_id;
    };
    const action = async (value: Record<string, unknown>) => {
      const state = await author.authorized<components["schemas"]["WorkState"]>(`/my/works/${id}`);
      return author.authorized(`/my/works/${id}/actions`, { method: "POST", body: {
        mutation_id: randomUUID(), expected_state_revision: state.state_revision, ...value,
      } });
    };
    await publish(saved.revision);
    const first = await work(id);
    await author.authorized("/drafts/save", { method: "POST", body: { mutation_id: randomUUID(),
      draft_id: saved.draft_id, base_revision: saved.revision, title: "合成版本二", content: "合成故事第二版，有明确修订，仍是完整的测试故事。" } });
    await publish(saved.revision + 1);
    assert.equal((await work(id)).version, 2);
    const closed = await timeline(id);
    assert.deepEqual(closed.versions.map((v) => v.version), [2, 1]);
    assert.equal(closed.history_open, false);
    assert.equal(closed.versions.find((v) => v.version === 1)?.readable, false);
    await assert.rejects(readVersion(id, 1), (e: unknown) => e instanceof ReaderError && e.kind === "unavailable");
    await action({ action: "set_history", history_open: true });
    const historical = await readVersion(id, 1);
    assert.equal(historical.title, first.title);
    await action({ action: "set_history", history_open: false });
    await assert.rejects(readVersion(id, 1), (e: unknown) => e instanceof ReaderError && e.kind === "unavailable");
    const comments = new CommentsApi((path, options) => author.authorized(path, options));
    const root = await comments.create(id, { mutation_id: randomUUID(), expected_account_id: author.snapshot().account!.id,
      content: "已加载的正常旧版，关闭历史后仍可评论。", reply_to: null, context: historical.comment_context! });
    const review = await operator.authorized<components["schemas"]["ModerationDetail"]>(`/ops/reviews/${id}/versions/1`);
    await operator.authorized(`/ops/reviews/${id}/versions/1`, { method: "POST", body: {
      mutation_id: randomUUID(), expected_revision: review.task.revision, decision: "restrict_version", reason: "合成验收：验证受限节点不展示。",
    } });
    await action({ action: "set_history", history_open: true });
    const limited = await timeline(id);
    assert.deepEqual(limited.versions.map((v) => v.version), [2]);
    assert.ok(limited.events.every((e) => e.version !== 1));
    await assert.rejects(readVersion(id, 1), (e: unknown) => e instanceof ReaderError && e.kind === "unavailable");
    assert.ok((await comments.list(id)).items.some((c) => c.id === root.id));
    await action({ action: "hide" });
    await assert.rejects(timeline(id), (e: unknown) => e instanceof ReaderError && e.kind === "unavailable");
    await assert.rejects(readVersion(id, 2), (e: unknown) => e instanceof ReaderError && e.kind === "unavailable");
  } finally {
    // Only this newly created synthetic work is hidden; never mutate existing user works.
    if (id) {
      const state = await author.authorized<components["schemas"]["WorkState"]>(`/my/works/${id}`);
      if (!state.author_hidden) await author.authorized(`/my/works/${id}/actions`, { method: "POST", body: {
        mutation_id: randomUUID(), expected_state_revision: state.state_revision, action: "hide",
      } });
    }
    if (author.snapshot().phase === "ready") await author.logout();
    if (operator.snapshot().phase === "ready") await operator.logout();
  }
});
