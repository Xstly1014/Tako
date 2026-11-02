import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Session } from "../src/auth/session.ts";
import { request, ApiError } from "../src/api/client.ts";
import { PublicationsApi } from "../src/api/publications.ts";
import { PublicationFlow } from "../src/publication/flow.ts";
import { AuthorWorksApi } from "../src/api/author-works.ts";
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
test("真实原生发布：固定旧修订、丢响应重开只读、原预览唯一、并发冲突与隐藏中修订", async () => {
  await community("", "");
  const a = session(),
    b = session();
  await a.restore();
  await b.restore();
  let workId = "",
    raw: string | null = null;
  const store = {
    get: async () => raw,
    set: async (v: string) => {
      raw = v;
    },
    remove: async () => {
      raw = null;
    },
  };
  const api = new PublicationsApi((path, opts) => a.authorized(path, opts));
  const author = new AuthorWorksApi((path, opts) => a.authorized(path, opts));
  try {
    await a.signIn(
      "register",
      `publish-${randomUUID()}@example.test`,
      randomUUID(),
    );
    await a.setNickname("原生发布合成作者");
    await b.signIn(
      "register",
      `publish-other-${randomUUID()}@example.test`,
      randomUUID(),
    );
    await b.setNickname("发布隔离合成账号");
    const draft = await a.authorized<components["schemas"]["WriteResult"]>(
      "/drafts/create",
      {
        method: "POST",
        body: {
          mutation_id: randomUUID(),
          title: "固定旧修订",
          content: "仅供原生发布验收的第一版合成正文。",
        },
      },
    );
    const drop = new PublicationsApi(async (path, opts) => {
      const value = await a.authorized(path, opts);
      if (path === "/publications") {
        const result = value as components["schemas"]["PublicationResult"];
        workId = result.work_id;
        throw new ApiError("network");
      }
      return value as never;
    });
    const flow = new PublicationFlow(
      drop,
      store,
      a.snapshot().account!.id,
      () => a.snapshot().phase === "ready",
      randomUUID,
    );
    await flow.restore();
    await flow.prepare(
      draft.draft_id,
      draft.revision,
      "合成简介",
      ["日常"],
      true,
    );
    const preview = flow.preview!;
    await a.authorized("/drafts/save", {
      method: "POST",
      body: {
        mutation_id: randomUUID(),
        draft_id: draft.draft_id,
        base_revision: draft.revision,
        title: "新工作稿仍私密",
        content: "后写的第二版合成文字，不应替换旧快照。",
      },
    });
    await assert.rejects(flow.publish());
    assert.ok(raw);
    const reopened = new PublicationFlow(
      api,
      store,
      a.snapshot().account!.id,
      () => a.snapshot().phase === "ready",
      randomUUID,
    );
    await reopened.restore();
    assert.equal(reopened.result?.version, 1);
    assert.equal((await work(workId)).title, "固定旧修订");
    const again = await api.publish({
      mutation_id: randomUUID(),
      preview_id: preview.id,
      expected_version: 0,
    });
    assert.equal(again.version, 1);
    assert.equal((await author.timeline(workId)).versions.length, 1);
    const other = new PublicationsApi((path, opts) => b.authorized(path, opts));
    await assert.rejects(
      other.read(preview.id),
      (e: unknown) => e instanceof ApiError && e.status === 404,
    );
    await assert.rejects(
      other.prepare({
        mutation_id: randomUUID(),
        draft_id: draft.draft_id,
        source_revision: 2,
        introduction: "",
        tags: ["日常"],
        rights_confirmed: true,
      }),
    );
    const state = (await author.timeline(workId)).state;
    await author.change(workId, {
      mutation_id: randomUUID(),
      expected_state_revision: state.state_revision,
      action: "hide",
    });
    const first = await api.prepare({
      mutation_id: randomUUID(),
      draft_id: draft.draft_id,
      source_revision: 2,
      introduction: "",
      tags: ["日常"],
      rights_confirmed: true,
    });
    const competing = await api.prepare({
      mutation_id: randomUUID(),
      draft_id: draft.draft_id,
      source_revision: 2,
      introduction: "",
      tags: ["日常"],
      rights_confirmed: true,
    });
    await api.publish({
      mutation_id: randomUUID(),
      preview_id: first.id,
      expected_version: first.expected_version,
    });
    await assert.rejects(
      api.publish({
        mutation_id: randomUUID(),
        preview_id: competing.id,
        expected_version: competing.expected_version,
      }),
      (e: unknown) =>
        e instanceof ApiError && e.code === "publication_conflict",
    );
    const current = await api.state(workId, draft.draft_id);
    assert.equal(current.author_hidden, true);
    assert.equal(current.last_version, 2);
    assert.equal(
      (
        await a.authorized<components["schemas"]["Draft"]>(
          `/drafts/${draft.draft_id}`,
        )
      ).revision,
      2,
    );
    await assert.rejects(work(workId));
    await reopened.reset();
    assert.equal(raw, null);
  } finally {
    if (workId && a.snapshot().phase === "ready") {
      const state = (await author.timeline(workId)).state;
      if (!state.author_hidden)
        await author.change(workId, {
          mutation_id: randomUUID(),
          expected_state_revision: state.state_revision,
          action: "hide",
        });
    }
    for (const s of [a, b])
      if (s.snapshot().phase === "ready") await s.logout();
  }
});
