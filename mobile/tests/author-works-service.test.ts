import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Session } from "../src/auth/session.ts";
import { request, ApiError } from "../src/api/client.ts";
import { AuthorWorksApi, WorkAction } from "../src/api/author-works.ts";
import { community, work } from "../src/api/reader.ts";
import type { components } from "../src/api/contract";
const session = () => {
  let token: string | null = null;
  return new Session(
    {
      get: async () => token,
      set: async (v) => {
        token = v;
      },
      remove: async () => {
        token = null;
      },
    },
    request,
  );
};
test("真实作者管理：会话归属、丢响应重放、并发冲突、受限旧版显式恢复且工作稿不变", async () => {
  await community("", "");
  const env = Object.fromEntries(
    (
      await readFile(
        new URL("../../.runtime/local-test/.env", import.meta.url),
        "utf8",
      )
    )
      .split(/\r?\n/)
      .filter((x) => x.includes("=") && !x.startsWith("#"))
      .map((x) => {
        const p = x.indexOf("=");
        return [x.slice(0, p), x.slice(p + 1)];
      }),
  );
  assert.ok(env.TEST_OPERATOR_PASSWORD);
  const author = session(),
    other = session(),
    operator = session();
  await Promise.all([author.restore(), other.restore(), operator.restore()]);
  let id = "";
  const api = new AuthorWorksApi((path, options) =>
    author.authorized(path, options),
  );
  try {
    await author.signIn(
      "register",
      `manage-${randomUUID()}@example.test`,
      randomUUID(),
    );
    await author.setNickname("作品管理合成验收");
    await other.signIn(
      "register",
      `manage-other-${randomUUID()}@example.test`,
      randomUUID(),
    );
    await other.setNickname("管理隔离合成账号");
    await operator.signIn(
      "login",
      "operator@tako-test.invalid",
      env.TEST_OPERATOR_PASSWORD,
    );
    const draft = await author.authorized<components["schemas"]["WriteResult"]>(
      "/drafts/create",
      {
        method: "POST",
        body: {
          mutation_id: randomUUID(),
          title: "管理测试版本一",
          content: "仅用于作者作品管理的合成正文。",
        },
      },
    );
    for (let n = 1; n <= 2; n++) {
      if (n === 2)
        await author.authorized("/drafts/save", {
          method: "POST",
          body: {
            mutation_id: randomUUID(),
            draft_id: draft.draft_id,
            base_revision: draft.revision,
            title: "管理测试版本二",
            content: "第二版合成工作稿。",
          },
        });
      const preview = await author.authorized<
        components["schemas"]["PublicationPreview"]
      >("/publication-previews", {
        method: "POST",
        body: {
          mutation_id: randomUUID(),
          draft_id: draft.draft_id,
          source_revision: n,
          introduction: "合成作品管理",
          tags: ["日常"],
          rights_confirmed: true,
        },
      });
      id = (
        await author.authorized<components["schemas"]["PublicationResult"]>(
          "/publications",
          {
            method: "POST",
            body: {
              mutation_id: randomUUID(),
              preview_id: preview.id,
              expected_version: preview.expected_version,
            },
          },
        )
      ).work_id;
    }
    const savedDraft = await author.authorized(`/drafts/${draft.draft_id}`);
    assert.ok((await api.list()).items.some((x) => x.id === id));
    const foreign = new AuthorWorksApi((path, options) =>
      other.authorized(path, options),
    );
    assert.ok(!(await foreign.list()).items.some((x) => x.id === id));
    await assert.rejects(
      foreign.timeline(id),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
    await assert.rejects(
      foreign.version(id, 1),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
    const op = new WorkAction(
      id,
      () => author.snapshot().phase === "ready",
      randomUUID,
    );
    const initial = await api.timeline(id),
      hide = op.prepare(initial.state, "hide");
    let lose = true;
    const dropping = new AuthorWorksApi(async (path, options) => {
      const result = await author.authorized(path, options);
      if (lose) {
        lose = false;
        throw new ApiError("network");
      }
      return result as never;
    });
    await assert.rejects(op.send(hide, dropping));
    await op.send(hide, api);
    await assert.rejects(work(id));
    await op.send(op.prepare((await api.timeline(id)).state, "restore"), api);
    assert.equal((await work(id)).version, 2);
    await op.send(
      op.prepare((await api.timeline(id)).state, "switch_display", 1),
      api,
    );
    assert.equal((await work(id)).version, 1);
    await op.send(
      op.prepare((await api.timeline(id)).state, "switch_display", 2),
      api,
    );
    assert.equal((await work(id)).version, 2);
    await op.send(op.prepare((await api.timeline(id)).state, "hide"), api);
    await assert.rejects(
      api.change(id, {
        mutation_id: randomUUID(),
        expected_state_revision: initial.state.state_revision,
        action: "set_history",
        history_open: true,
      }),
      (e: unknown) => e instanceof ApiError && e.code === "work_state_conflict",
    );
    const review = await operator.authorized<
      components["schemas"]["ModerationDetail"]
    >(`/ops/reviews/${id}/versions/2`);
    await operator.authorized(`/ops/reviews/${id}/versions/2`, {
      method: "POST",
      body: {
        mutation_id: randomUUID(),
        expected_revision: review.task.revision,
        decision: "restrict_version",
        reason: "合成验证：受限最新版不得静默恢复旧版。",
      },
    });
    let current = await api.timeline(id);
    assert.equal(
      current.versions.find((x) => x.version === 2)?.platform_limited,
      true,
    );
    assert.equal((await api.version(id, 2)).version, 2);
    await assert.rejects(
      op.send(op.prepare(current.state, "restore"), api),
      (e: unknown) => e instanceof ApiError && e.code === "version_unavailable",
    );
    assert.equal(op.pending, null);
    current = await api.timeline(id);
    await op.send(op.prepare(current.state, "restore", 1), api);
    assert.equal((await work(id)).version, 1);
    current = await api.timeline(id);
    await op.send(
      op.prepare(current.state, "set_history", undefined, true),
      api,
    );
    assert.equal((await api.timeline(id)).state.history_open, true);
    await assert.rejects(
      foreign.change(id, {
        mutation_id: randomUUID(),
        expected_state_revision: (await api.timeline(id)).state.state_revision,
        action: "hide",
      }),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
    assert.deepEqual(
      await author.authorized(`/drafts/${draft.draft_id}`),
      savedDraft,
    );
    await op.send(op.prepare((await api.timeline(id)).state, "hide"), api);
    const workReview = await operator.authorized<
      components["schemas"]["ModerationDetail"]
    >(`/ops/reviews/${id}/versions/1`);
    await operator.authorized(`/ops/reviews/${id}/versions/1`, {
      method: "POST",
      body: {
        mutation_id: randomUUID(),
        expected_revision: workReview.task.revision,
        decision: "restrict_work",
        reason: "合成验证：作品整体限制优先。",
      },
    });
    current = await api.timeline(id);
    assert.equal(current.state.platform_limited, true);
    assert.throws(
      () => op.prepare(current.state, "restore", 1),
      (e: unknown) => e instanceof ApiError && e.code === "work_restricted",
    );
    await assert.rejects(
      api.change(id, {
        mutation_id: randomUUID(),
        expected_state_revision: current.state.state_revision,
        action: "restore",
        version: 1,
      }),
      (e: unknown) => e instanceof ApiError && e.code === "work_restricted",
    );
  } finally {
    if (id && author.snapshot().phase === "ready") {
      const current = await api.timeline(id);
      if (!current.state.author_hidden)
        await api.change(id, {
          mutation_id: randomUUID(),
          expected_state_revision: current.state.state_revision,
          action: "hide",
        });
    }
    for (const s of [author, other, operator])
      if (s.snapshot().phase === "ready") await s.logout();
  }
});
