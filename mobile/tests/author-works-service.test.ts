import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Session } from "../src/auth/session.ts";
import { request, ApiError } from "../src/api/client.ts";
import { AuthorWorksApi, WorkAction } from "../src/api/author-works.ts";
import { community, work } from "../src/api/reader.ts";
import type { components } from "../src/api/contract";
import {
  AuthorCatalog,
  emptyCatalogQuery,
} from "../src/author-works/catalog.ts";
import { catalogFixture } from "./helpers/catalog-fixture.ts";
import { AuthorAppealsApi, type CasePage } from "../src/api/author-appeals.ts";
import { AuthorAppeals } from "../src/author-works/appeals.ts";
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
test("真实M4：固定旧版处置、复核丢响应/回读失败、维持冷静期与主动撤销不越范围", async () => {
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
  const works = new AuthorWorksApi((path, options) =>
    author.authorized(path, options),
  );
  let workID = "";
  try {
    await author.signIn(
      "register",
      `appeals-${randomUUID()}@example.test`,
      randomUUID(),
    );
    await author.setNickname("复核合成作者");
    await other.signIn(
      "register",
      `appeals-other-${randomUUID()}@example.test`,
      randomUUID(),
    );
    await other.setNickname("隔离合成账号");
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
          title: "复核正式旧版",
          content: "固定旧版本合成正文。",
        },
      },
    );
    for (let version = 1; version <= 2; version++) {
      if (version === 2)
        await author.authorized("/drafts/save", {
          method: "POST",
          body: {
            mutation_id: randomUUID(),
            draft_id: draft.draft_id,
            base_revision: 1,
            title: "复核正式新版",
            content: "正式新版合成正文。",
          },
        });
      const preview = await author.authorized<
        components["schemas"]["PublicationPreview"]
      >("/publication-previews", {
        method: "POST",
        body: {
          mutation_id: randomUUID(),
          draft_id: draft.draft_id,
          source_revision: version,
          introduction: "复核链路合成验证",
          tags: ["日常"],
          rights_confirmed: true,
        },
      });
      const published = await author.authorized<
        components["schemas"]["PublicationResult"]
      >("/publications", {
        method: "POST",
        body: {
          mutation_id: randomUUID(),
          preview_id: preview.id,
          expected_version: preview.expected_version,
        },
      });
      workID = published.work_id;
    }
    const saved = await author.authorized(`/drafts/${draft.draft_id}`);
    const review = await operator.authorized<
      components["schemas"]["ModerationDetail"]
    >(`/ops/reviews/${workID}/versions/1`);
    await operator.authorized(`/ops/reviews/${workID}/versions/1`, {
      method: "POST",
      body: {
        mutation_id: randomUUID(),
        expected_revision: review.task.revision,
        decision: "restrict_version",
        reason: "只检查固定旧版",
      },
    });
    const cases = await author.authorized<CasePage>("/my/moderation");
    const caseID = cases.items.find((x) => x.work_id === workID)!.id;
    const foreign = new AuthorAppealsApi((path, options) =>
      other.authorized(path, options),
    );
    assert.equal(
      (await foreign.list()).items.some((x) => x.id === caseID),
      false,
    );
    await assert.rejects(
      foreign.detail(caseID),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
    assert.equal((await work(workID)).version, 2);
    const posted: unknown[] = [];
    let drop = true,
      failRead = false;
    const api = new AuthorAppealsApi(async (path, options) => {
      const result = await author.authorized(path, options);
      if (options?.method === "POST") {
        posted.push(structuredClone(options.body));
        if (drop) {
          drop = false;
          throw new ApiError("network");
        }
        if (posted.length === 2) failRead = true;
      } else if (path.startsWith(`/my/moderation/${caseID}?`) && failRead) {
        failRead = false;
        throw new ApiError("network");
      }
      return result as never;
    });
    const flow = new AuthorAppeals(
      api,
      () => author.snapshot().phase === "ready",
      randomUUID,
    );
    await flow.read();
    assert.ok(flow.snapshot().page.items.some((x) => x.id === caseID));
    await flow.open(caseID);
    assert.equal(flow.snapshot().detail?.work.version, 1);
    assert.equal(flow.snapshot().detail?.work.title, "复核正式旧版");
    flow.prepare("请重新检查固定旧版指定位置。");
    await flow.send();
    assert.ok(flow.snapshot().pending);
    const competing = new AuthorAppealsApi((path, options) =>
      author.authorized(path, options),
    );
    await Promise.all([
      flow.send(),
      assert.rejects(
        competing.appeal(caseID, {
          mutation_id: randomUUID(),
          expected_revision: 1,
          decision: "appeal",
          reason: "另一客户端并发新申请",
        }),
        (e: unknown) =>
          e instanceof ApiError &&
          e.code === "appeal_pending" &&
          e.status === 409,
      ),
    ]);
    assert.equal(flow.snapshot().pending, null);
    assert.equal(flow.snapshot().confirmed, true);
    assert.equal(flow.snapshot().needsRead, true);
    assert.deepEqual(posted[0], posted[1]);
    await flow.read();
    assert.equal(posted.length, 2);
    assert.equal(flow.snapshot().detail?.appeals.items.length, 1);
    const appealID = flow.snapshot().detail!.appeals.items[0].id;
    await operator.authorized(`/ops/moderation/${caseID}`, {
      method: "POST",
      body: {
        mutation_id: randomUUID(),
        expected_revision: 1,
        decision: "uphold",
        appeal_id: appealID,
        reason: "重新检查后维持旧版处置",
      },
    });
    await flow.read();
    assert.equal(flow.snapshot().detail?.appeals.items[0].state, "upheld");
    assert.ok(flow.snapshot().detail?.case.next_appeal_at);
    flow.prepare("补充新理由仍由服务端校验时间");
    await flow.send();
    assert.equal((flow.snapshot().error as ApiError).code, "appeal_cooldown");
    assert.equal(flow.snapshot().pending, null);
    // A separate work-level restriction must survive revocation of the old version case.
    const latestReview = await operator.authorized<
      components["schemas"]["ModerationDetail"]
    >(`/ops/reviews/${workID}/versions/2`);
    await operator.authorized(`/ops/reviews/${workID}/versions/2`, {
      method: "POST",
      body: {
        mutation_id: randomUUID(),
        expected_revision: latestReview.task.revision,
        decision: "restrict_work",
        reason: "独立作品整体处置",
      },
    });
    await operator.authorized(`/ops/moderation/${caseID}`, {
      method: "POST",
      body: {
        mutation_id: randomUUID(),
        expected_revision: 2,
        decision: "revoke",
        reason: "主动纠正这条旧版处置",
      },
    });
    await flow.read();
    assert.equal(flow.snapshot().detail?.case.state, "revoked");
    assert.equal(
      flow.snapshot().detail?.revocation?.reason,
      "主动纠正这条旧版处置",
    );
    assert.throws(() => flow.prepare("已撤销不可申请"));
    const state = (await works.timeline(workID)).state;
    assert.equal(state.platform_limited, true);
    assert.equal(state.author_hidden, false);
    assert.equal(state.display_version, 2);
    await assert.rejects(work(workID));
    assert.deepEqual(
      await author.authorized(`/drafts/${draft.draft_id}`),
      saved,
    );
    flow.dispose();
  } finally {
    if (workID && author.snapshot().phase === "ready") {
      const state = (await works.timeline(workID)).state;
      if (!state.author_hidden)
        await works.change(workID, {
          mutation_id: randomUUID(),
          expected_state_revision: state.state_revision,
          action: "hide",
        });
    }
    for (const s of [author, other, operator])
      if (s.snapshot().phase === "ready") await s.logout();
  }
});
test("真实M3完整工作台：45历史作品三页、全量查找、管理后原条件刷新与账号隔离", async () => {
  const author = session(),
    other = session();
  let fixture: ReturnType<typeof catalogFixture> | undefined;
  try {
    await author.signIn(
      "register",
      `catalog-${randomUUID()}@example.test`,
      randomUUID(),
    );
    await author.setNickname("目录合成验收");
    const account = author.snapshot().account;
    assert.ok(account);
    fixture = catalogFixture(account.id);
    const api = new AuthorWorksApi((path, options) =>
      author.authorized(path, options),
    );
    const catalog = new AuthorCatalog(
      api,
      () => author.snapshot().account?.id === account.id,
    );
    await catalog.apply(emptyCatalogQuery());
    assert.equal(catalog.snapshot().error, null);
    assert.equal(catalog.snapshot().page.items.length, 20);
    await catalog.more();
    assert.equal(catalog.snapshot().page.items.length, 40);
    await catalog.more();
    assert.equal(catalog.snapshot().page.items.length, 45);
    assert.equal(catalog.snapshot().page.next_cursor, "");
    await catalog.apply({
      q: "CATALOG 00",
      visibility: "hidden",
      restriction: "unrestricted",
    });
    assert.equal(catalog.snapshot().page.items[0]?.id, fixture.ids[0]);
    const initial = await api.timeline(fixture.ids[0]);
    const action = new WorkAction(
      initial.state.id,
      () => author.snapshot().phase === "ready",
      randomUUID,
    );
    await action.send(action.prepare(initial.state, "restore", 1), api);
    await catalog.refresh();
    assert.equal(catalog.snapshot().error, null);
    assert.equal(catalog.snapshot().query.q, "catalog 00");
    assert.equal(catalog.snapshot().page.items.length, 0);
    await catalog.apply({
      q: "catalog 00",
      visibility: "shown",
      restriction: "all",
    });
    assert.equal(catalog.snapshot().page.items[0]?.id, fixture.ids[0]);
    await other.signIn(
      "register",
      `catalog-other-${randomUUID()}@example.test`,
      randomUUID(),
    );
    const foreign = new AuthorWorksApi((path, options) =>
      other.authorized(path, options),
    );
    assert.equal((await foreign.catalog(emptyCatalogQuery())).items.length, 0);
    await assert.rejects(
      foreign.timeline(fixture.ids[0]),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
    catalog.cancel();
  } finally {
    fixture?.cleanup();
    for (const current of [author, other])
      if (current.snapshot().phase === "ready") await current.logout();
  }
});
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
