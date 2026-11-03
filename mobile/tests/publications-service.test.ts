import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Session } from "../src/auth/session.ts";
import { request, ApiError } from "../src/api/client.ts";
import { PublicationsApi } from "../src/api/publications.ts";
import { PublicationFlow } from "../src/publication/flow.ts";
import { AuthorWorksApi } from "../src/api/author-works.ts";
import { community, work } from "../src/api/reader.ts";
import { readVersion } from "../src/api/versions.ts";
import { readRevisionReview } from "../src/publication/revision-review.ts";
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
test("真实API修订发行闭环：同作品追加、丢响应恢复、竞争、隐藏与展示历史权限", async () => {
  await community("", "");
  const a = session(),
    b = session();
  await a.restore();
  await b.restore();
  let workId = "",
    otherWorkId = "",
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
    const secondDraft = await a.authorized<components["schemas"]["WriteResult"]>("/drafts/create", {
      method: "POST", body: { mutation_id: randomUUID(), title: "另一部合成作品", content: "另一部作品的独立正文。" },
    });
    const secondPreview = await api.prepare({ mutation_id: randomUUID(), draft_id: secondDraft.draft_id,
      source_revision: 1, introduction: "", tags: ["日常"], rights_confirmed: true });
    otherWorkId = (await api.publish({ mutation_id: randomUUID(), preview_id: secondPreview.id, expected_version: 0 })).work_id;
    assert.notEqual(otherWorkId, workId);
    const secondState = await api.state(otherWorkId, secondDraft.draft_id);
    await author.change(otherWorkId, { mutation_id: randomUUID(), expected_state_revision: secondState.state_revision, action: "hide" });
    const directed = new PublicationsApi((path, opts) => a.authorized(path, opts), workId);
    const target = await directed.revisionTarget(workId);
    assert.equal(target.source.id, draft.draft_id);
    assert.equal(target.source.revision, 2);
    const reviewed = await readRevisionReview(directed, author, target.state, 2);
    assert.equal(reviewed.source.content, (await api.source(draft.draft_id)).content);
    assert.equal(reviewed.current.version, target.state.display_version);
    assert.equal(reviewed.changed.content, true);
    assert.equal((await api.revisionTarget(otherWorkId)).source.id, secondDraft.draft_id);
    await assert.rejects(other.revisionTarget(workId));
    const draftBeforeIssue = await api.source(draft.draft_id);
    const state = (await author.timeline(workId)).state;
    await author.change(workId, {
      mutation_id: randomUUID(),
      expected_state_revision: state.state_revision,
      action: "hide",
    });
    await assert.rejects(readRevisionReview(directed, author, target.state, 2),
      (e: unknown) => e instanceof ApiError && e.code === "revision_review_changed");
    const hiddenReview = await readRevisionReview(directed, author, await api.state(workId, draft.draft_id), 2);
    assert.equal(hiddenReview.state.author_hidden, true);
    await assert.rejects(readRevisionReview(other, new AuthorWorksApi((p, o) => b.authorized(p, o)), target.state, 2));
    const first = await directed.prepare({
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
    const issued = await directed.publish({
      mutation_id: randomUUID(),
      preview_id: first.id,
      expected_version: first.expected_version,
    });
    assert.equal(issued.work_id, workId);
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
    assert.equal(current.display_version, 2);
    assert.equal((await author.list()).items.length, 2);
    assert.equal((await author.timeline(otherWorkId)).state.last_version, 1);
    assert.deepEqual(await api.source(draft.draft_id), draftBeforeIssue);
    assert.equal(
      (
        await a.authorized<components["schemas"]["Draft"]>(
          `/drafts/${draft.draft_id}`,
        )
      ).revision,
      2,
    );
    await assert.rejects(work(workId));
    await author.change(workId, { mutation_id: randomUUID(), expected_state_revision: current.state_revision, action: "restore" });
    assert.equal((await work(workId)).version, 2);
    let managed = await api.state(workId, draft.draft_id);
    await author.change(workId, { mutation_id: randomUUID(), expected_state_revision: managed.state_revision, action: "switch_display", version: 1 });
    assert.equal((await work(workId)).version, 1);
    await assert.rejects(readVersion(workId, 2));
    managed = await api.state(workId, draft.draft_id);
    await author.change(workId, { mutation_id: randomUUID(), expected_state_revision: managed.state_revision, action: "set_history", history_open: true });
    assert.equal((await readVersion(workId, 2)).version, 2);
    assert.deepEqual(await api.source(draft.draft_id), draftBeforeIssue);
    await reopened.reset();
    assert.equal(raw, null);
  } finally {
    for (const managedId of [workId, otherWorkId].filter(Boolean)) if (a.snapshot().phase === "ready") {
      const state = (await author.timeline(managedId)).state;
      if (!state.author_hidden)
        await author.change(managedId, {
          mutation_id: randomUUID(),
          expected_state_revision: state.state_revision,
          action: "hide",
        });
    }
    for (const s of [a, b])
      if (s.snapshot().phase === "ready") await s.logout();
  }
});
