import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  PublicationsApi,
  publicationInput,
  checkedPreview,
  type Preview,
} from "../src/api/publications.ts";
import { PublicationFlow, type JournalStore } from "../src/publication/flow.ts";
import type { Transport } from "../src/auth/session.ts";
import { ApiError } from "../src/api/client.ts";
import { AuthorWorksApi } from "../src/api/author-works.ts";
import { readRevisionReview } from "../src/publication/revision-review.ts";
const account = randomUUID(),
  draft = randomUUID(),
  previewId = randomUUID(),
  workId = randomUUID();
const preview = (): Preview => ({
  id: previewId,
  draft_id: draft,
  source_revision: 1,
  expected_version: 0,
  title: "固定标题",
  content: "固定正文",
  introduction: "简介",
  tags: ["日常"],
  created_at: "2026-11-02T00:00:00Z",
  expires_at: "2026-11-03T00:00:00Z",
});
const result = () => ({
  work_id: workId,
  version: 1,
  published_at: "2026-11-02T00:00:00Z",
  review_status: "pending" as const,
});
const api = (
  fn: (path: string, options?: Parameters<Transport>[1]) => Promise<unknown>,
) => new PublicationsApi(fn as Transport);
test("发布入口保留明确的服务器修订；无参数才进入选择器", () => {
  assert.deepEqual(publicationInput({}), { draftId: "", revision: 0 });
  assert.deepEqual(
    publicationInput({ draft_id: draft, source_revision: "1" }),
    {
      draftId: draft,
      revision: 1,
    },
  );
});
test("不完整或含糊的发布交接拒绝，不能静默改用最新修订", () => {
  const invalid = [
    { draft_id: draft },
    { source_revision: "1" },
    { draft_id: [draft], source_revision: "1" },
    { draft_id: draft, source_revision: ["1"] },
    { draft_id: "", source_revision: "1" },
    { draft_id: "00000000-0000-0000-0000-000000000000", source_revision: "1" },
    ...["", "0", "-1", "1.5", "1e2", " 1", "01", "9007199254740992"].map(
      (source_revision) => ({ draft_id: draft, source_revision }),
    ),
  ];
  for (const params of invalid)
    assert.throws(
      () => publicationInput(params),
      (e: unknown) => e instanceof ApiError && e.code === "invalid_input",
    );
});
test("M2只以作品标识进入；与C1修订对混用或坏标识均拒绝", () => {
  assert.deepEqual(publicationInput({ work_id: workId }), {
    draftId: "",
    revision: 0,
    workId,
  });
  for (const work_id of [
    "",
    [workId],
    "00000000-0000-0000-0000-000000000000",
    "bad",
  ])
    assert.throws(() => publicationInput({ work_id }));
  assert.throws(() =>
    publicationInput({
      work_id: workId,
      draft_id: draft,
      source_revision: "1",
    }),
  );
});
const targetTimeline = () => ({
  state: {
    id: workId,
    draft_id: draft,
    last_version: 2,
    display_version: 1,
    state_revision: 3,
    author_hidden: true,
    history_open: false,
    platform_limited: false,
  },
  versions: [
    {
      version: 2,
      title: "作品目标",
      published_at: "2026-11-02T00:00:00Z",
      platform_limited: false,
      review_status: "pending",
    },
  ],
  events: [],
  next_version_before: 0,
  next_event_before: 0,
});
test("定向发行从本人作品绑定读取服务器R，返回给页面的来源不含正文", async () => {
  const calls: string[] = [];
  const target = await api(async (path) => {
    calls.push(path);
    return path.startsWith("/my/works/")
      ? targetTimeline()
      : { id: draft, revision: 7, title: "工作稿", content: "仅服务端正文" };
  }).revisionTarget(workId);
  assert.equal(target.state.id, workId);
  assert.deepEqual(target.source, { id: draft, revision: 7, title: "工作稿" });
  assert.deepEqual(calls, [
    `/my/works/${workId}/versions?before_version=0&before_event=0`,
    `/drafts/${draft}`,
  ]);
});
test("目标归属或绑定异常不能继续读另一作品稿件", async () => {
  let calls = 0;
  await assert.rejects(
    api(async () => {
      calls++;
      return {
        ...targetTimeline(),
        state: { ...targetTimeline().state, id: randomUUID() },
      };
    }).revisionTarget(workId),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    api(async (path) =>
      path.startsWith("/my/")
        ? targetTimeline()
        : { id: randomUUID(), revision: 1, title: "另一稿", content: "" },
    ).revisionTarget(workId),
  );
});
test("目标读取失败或最新正式版本资料缺失时拒绝猜测目标", async () => {
  await assert.rejects(
    api(async () => {
      throw new ApiError("network");
    }).revisionTarget(workId),
  );
  await assert.rejects(
    api(async () => ({ ...targetTimeline(), versions: [] })).revisionTarget(
      workId,
    ),
  );
});
test("定向预览前验证绑定，错误作品回执不确认且原请求保留", async () => {
  const store = vault();
  const client = new PublicationsApi(
    (async (path: string) => {
      if (path === `/my/works/${workId}`) return targetTimeline().state;
      if (path === "/publication-previews")
        return { ...preview(), expected_version: 2 };
      return { ...result(), work_id: randomUUID(), version: 3 };
    }) as Transport,
    workId,
  );
  const f = flow(client, store);
  await f.restore();
  await f.prepare(draft, 1, "", ["日常"], true);
  await assert.rejects(
    f.publish(),
    (e: unknown) => e instanceof ApiError && e.code === "contract",
  );
  assert.equal(f.result, null);
  assert.ok(f.pendingPublish);
  assert.ok(store.value());
  let prepared = 0;
  const invalid = new PublicationsApi(
    (async (path: string) => {
      if (path === "/publication-previews") prepared++;
      return { ...targetTimeline().state, draft_id: randomUUID() };
    }) as Transport,
    workId,
  );
  await assert.rejects(
    invalid.prepare({
      mutation_id: randomUUID(),
      draft_id: draft,
      source_revision: 1,
      introduction: "",
      tags: ["日常"],
      rights_confirmed: true,
    }),
  );
  assert.equal(prepared, 0);
});
function vault() {
  let value: string | null = null,
    broken = false;
  return {
    get: async () => value,
    set: async (v: string) => {
      if (broken) throw Error("storage");
      value = v;
    },
    remove: async () => {
      value = null;
    },
    value: () => value,
    fail: () => {
      broken = true;
    },
  };
}
function flow(
  client: PublicationsApi,
  store: JournalStore = vault(),
  valid = () => true,
  clock = () => Date.parse("2026-11-02T01:00:00Z"),
) {
  return new PublicationFlow(client, store, account, valid, randomUUID, clock);
}
test("预览必须授权且锁定服务器修订；丢响应沿原请求不读取新正文", async () => {
  const requests: unknown[] = [];
  const f = flow(
    api(async (_path, options) => {
      requests.push(structuredClone(options?.body));
      if (requests.length === 1) throw new ApiError("network");
      return preview();
    }),
  );
  await f.restore();
  await assert.rejects(f.prepare(draft, 1, "简介", ["日常"], false));
  assert.equal(requests.length, 0);
  await assert.rejects(f.prepare(draft, 1, "简介", ["日常"], true));
  await f.prepare(draft, 2, "新简介", ["幻想"], true);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(f.preview?.source_revision, 1);
  assert.equal(f.result, null);
});
test("发布先保留最小标识；存储失败不发 HTTP，正文与标题不进记录", async () => {
  const store = vault();
  let posts = 0;
  const f = flow(
    api(async (path) => {
      if (path === "/publication-previews") return preview();
      posts++;
      return result();
    }),
    store,
  );
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  store.fail();
  await assert.rejects(
    f.publish(),
    (e: unknown) => e instanceof ApiError && e.code === "storage",
  );
  assert.equal(posts, 0);
});
test("关闭重开只读取原预览，原请求重试唯一；确认记录不含正文或密码", async () => {
  const store = vault();
  let published = false,
    posts = 0;
  const client = api(async (path, options) => {
    if (path === "/publication-previews") return preview();
    if (path.startsWith("/publication-previews/"))
      return { ...preview(), ...(published ? { published: result() } : {}) };
    posts++;
    published = true;
    throw new ApiError("network");
  });
  const f = flow(client, store);
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  const saved = store.value()!;
  assert.ok(saved.includes(previewId));
  assert.ok(!saved.includes("固定"));
  assert.ok(!saved.includes("简介"));
  const reopened = flow(client, store);
  await reopened.restore();
  assert.equal(posts, 1);
  assert.deepEqual(reopened.result, result());
  await assert.rejects(reopened.publish());
  await reopened.reset();
  assert.equal(store.value(), null);
});
test("过期预览不提交；发布未知后的重试不被本机时间阻断", async () => {
  let now = Date.parse("2026-11-02T00:00:00Z"),
    calls = 0;
  const client = api(async (path) => {
    if (path === "/publication-previews") return preview();
    calls++;
    if (calls === 1) throw new ApiError("network");
    return result();
  });
  const f = flow(
    client,
    vault(),
    () => true,
    () => now,
  );
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  now = Date.parse("2026-11-04T00:00:00Z");
  await f.publish();
  assert.equal(calls, 2);
  const g = flow(
    client,
    vault(),
    () => true,
    () => now,
  );
  await g.restore();
  await g.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(g.publish());
  assert.equal(calls, 2);
});
test("账号切换与迟到结果不回填；损坏或跨账号记录拒绝恢复并保留", async () => {
  let current = true,
    release!: () => void;
  const f = flow(
    api(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return preview();
    }),
    vault(),
    () => current,
  );
  await f.restore();
  const pending = f.prepare(draft, 1, "简介", ["日常"], true);
  current = false;
  release();
  await assert.rejects(pending);
  assert.equal(f.preview, null);
  const store = vault();
  await store.set(JSON.stringify({ v: 1, account_id: randomUUID() }));
  const g = flow(
    api(async () => {
      throw Error("must_not_request");
    }),
    store,
  );
  await assert.rejects(g.restore());
  assert.ok(store.value());
});
test("错误预览身份和错版回执拒绝；明确冲突不自动生成新预览", async () => {
  assert.throws(() =>
    checkedPreview(
      { ...preview(), draft_id: randomUUID() },
      { draft_id: draft, source_revision: 1 },
    ),
  );
  const store = vault();
  const f = flow(
    api(async (path) =>
      path === "/publication-previews"
        ? preview()
        : Promise.reject(new ApiError("publication_conflict", "", 409)),
    ),
    store,
  );
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  assert.equal(f.pendingPublish, null);
  assert.equal(store.value(), null);
  assert.equal(f.preview?.id, previewId);
  await f.reset();
  assert.equal(f.preview, null);
});
test("同账号多个页面不覆盖待确认记录，旧页面确认不能清掉新请求", async () => {
  const store = vault();
  let release!: () => void,
    hold = true;
  const client = api(async (path) => {
    if (path === "/publication-previews") return preview();
    if (path.startsWith("/publication-previews/"))
      return { ...preview(), published: result() };
    if (hold) {
      hold = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return result();
  });
  const a = flow(client, store),
    b = flow(client, store);
  await a.restore();
  await b.restore();
  await a.prepare(draft, 1, "简介", ["日常"], true);
  await b.prepare(draft, 1, "简介", ["日常"], true);
  const first = a.publish();
  await Promise.resolve();
  await Promise.resolve();
  await assert.rejects(b.publish());
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  await first;
  const saved = store.value();
  await assert.rejects(
    b.publish(),
    (e: unknown) =>
      e instanceof ApiError && e.code === "another_publication_pending",
  );
  assert.equal(store.value(), saved);
  await b.restore();
  await a.reset();
  const c = flow(client, store);
  await c.restore();
  await c.prepare(draft, 1, "简介", ["日常"], true);
  await c.publish();
  const next = store.value();
  await assert.rejects(b.reset());
  assert.equal(store.value(), next);
});
test("服务器确认过期才清理原标识；错误恢复元数据使发布保持锁定", async () => {
  const store = vault();
  let posts = 0;
  const base = api(async (path) => {
    if (path === "/publication-previews") return preview();
    posts++;
    throw new ApiError("network");
  });
  const f = flow(base, store);
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  const saved = store.value()!;
  const wrong = flow(
    api(async () => ({ ...preview(), expected_version: 1 })),
    store,
  );
  await assert.rejects(wrong.restore());
  await assert.rejects(wrong.publish());
  assert.equal(store.value(), saved);
  const expired = flow(
    api(async () => {
      throw new ApiError("preview_expired", "", 410);
    }),
    store,
  );
  await assert.rejects(expired.restore());
  assert.equal(store.value(), null);
  assert.equal(posts, 1);
});
test("发布未知后会话失效仍保留标识，原账号重登只读确认", async () => {
  const store = vault();
  let posts = 0;
  const client = api(async (path) => {
    if (path === "/publication-previews") return preview();
    if (path.startsWith("/publication-previews/"))
      return { ...preview(), published: result() };
    posts++;
    throw new ApiError(
      posts === 1 ? "network" : "authentication_required",
      "",
      posts === 1 ? 0 : 401,
    );
  });
  const f = flow(client, store);
  await f.restore();
  await f.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(f.publish());
  const saved = store.value();
  await assert.rejects(f.publish());
  assert.equal(store.value(), saved);
  const restored = flow(client, store);
  await restored.restore();
  assert.equal(restored.result?.version, 1);
  assert.equal(posts, 2);
});

test("旧成功页恢复新记录失败，不能用旧结果确认并删除新未知请求", async () => {
  const store = vault(),
    nextPreview = { ...preview(), id: randomUUID(), expected_version: 1 };
  let prepares = 0,
    posts = 0,
    allowRead = false;
  const client = api(async (path) => {
    if (path === "/publication-previews")
      return ++prepares === 1 ? preview() : nextPreview;
    if (path === "/publication-previews/" + previewId)
      return { ...preview(), published: result() };
    if (path === "/publication-previews/" + nextPreview.id) {
      if (!allowRead) throw new ApiError("network");
      return nextPreview;
    }
    if (++posts === 1) return result();
    throw new ApiError("network");
  });
  const oldPage = flow(client, store),
    nextPage = flow(client, store);
  await oldPage.restore();
  await oldPage.prepare(draft, 1, "简介", ["日常"], true);
  await oldPage.publish();
  await nextPage.restore();
  await nextPage.reset();
  await nextPage.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(nextPage.publish());
  const saved = store.value();
  await assert.rejects(oldPage.restore());
  await assert.rejects(
    oldPage.reset(),
    (e: unknown) => e instanceof ApiError && e.code === "operation_pending",
  );
  assert.equal(store.value(), saved);
  assert.equal(oldPage.recoveryBlocked, true);
  assert.equal(oldPage.pendingPublish?.preview_id, previewId);
  allowRead = true;
  await oldPage.restore();
  assert.equal(oldPage.recoveryBlocked, false);
  assert.equal(oldPage.pendingPublish?.preview_id, nextPreview.id);
  assert.equal(oldPage.result, null);
  await assert.rejects(oldPage.reset());
  assert.equal(store.value(), saved);
  assert.equal(posts, 2);
});

test("确认过期期间记录已换成另一请求，不能清理或解除恢复保护", async () => {
  const store = vault();
  const original = flow(
    api(async (path) =>
      path === "/publication-previews"
        ? preview()
        : Promise.reject(new ApiError("network")),
    ),
    store,
  );
  await original.restore();
  await original.prepare(draft, 1, "简介", ["日常"], true);
  await assert.rejects(original.publish());
  const replacement = JSON.parse(store.value()!);
  replacement.request = {
    ...replacement.request,
    mutation_id: randomUUID(),
    preview_id: randomUUID(),
  };
  const saved = JSON.stringify(replacement);
  const reopened = flow(
    api(async () => {
      await store.set(saved);
      throw new ApiError("preview_expired", "", 410);
    }),
    store,
  );
  await assert.rejects(
    reopened.restore(),
    (e: unknown) =>
      e instanceof ApiError && e.code === "another_publication_pending",
  );
  assert.equal(reopened.recoveryBlocked, true);
  await assert.rejects(reopened.reset());
  assert.equal(store.value(), saved);
});

test("修订发行核对只读服务端所选R和展示V，精确区分标题正文并保留两份全文", async () => {
  const state = {
    id: workId,
    draft_id: draft,
    last_version: 3,
    display_version: 1,
    state_revision: 4,
    author_hidden: true,
    history_open: false,
    platform_limited: true,
  };
  for (const same of [false, true]) {
    const source = {
      id: draft,
      revision: 2,
      title: same ? "原题" : "新题",
      content: same ? "原文😀" : "原文😀\n新段",
      saved_at: "2026-11-03T00:00:00Z",
    };
    const transport: Transport = async (path, opts) => {
      assert.notEqual(opts?.method, "POST");
      if (path === "/drafts/" + draft) return source as never;
      if (path === "/my/works/" + workId) return state as never;
      assert.equal(path, "/my/works/" + workId + "/versions/1");
      return {
        id: workId,
        version: 1,
        title: "原题",
        content: "原文😀",
        introduction: "旧简介",
        tags: ["日常"],
        author_nickname: "作者",
        published_at: "2026-11-01T00:00:00Z",
      } as never;
    };
    const result = await readRevisionReview(
      new PublicationsApi(transport),
      new AuthorWorksApi(transport),
      state,
      2,
    );
    assert.deepEqual(result.changed, { title: !same, content: !same });
    assert.equal(result.source.content, source.content);
    assert.equal(result.current.content, "原文😀");
    assert.equal(result.state.author_hidden, true);
    assert.equal(result.state.platform_limited, true);
  }
});
test("核对期间改稿、作品竞争或读取失败不给可采用结果，不写入或自动追随新修订", async () => {
  for (const fault of ["before", "during", "state", "read"] as const) {
    const state = {
      id: workId,
      draft_id: draft,
      last_version: 1,
      display_version: 1,
      state_revision: 1,
      author_hidden: false,
      history_open: false,
      platform_limited: false,
    };
    let reads = 0;
    const transport: Transport = async (path, opts) => {
      assert.notEqual(opts?.method, "POST");
      if (path === "/drafts/" + draft) {
        reads++;
        return {
          id: draft,
          revision:
            fault === "before" || (fault === "during" && reads > 1) ? 3 : 2,
          title: "服务端",
          content: "完整正文",
        } as never;
      }
      if (path === "/my/works/" + workId)
        return { ...state, state_revision: fault === "state" ? 2 : 1 } as never;
      if (fault === "read") throw new ApiError("network");
      return {
        id: workId,
        version: 1,
        title: "原题",
        content: "原文",
        introduction: "",
        tags: ["日常"],
        author_nickname: "作者",
        published_at: "2026-11-01T00:00:00Z",
      } as never;
    };
    await assert.rejects(
      readRevisionReview(
        new PublicationsApi(transport),
        new AuthorWorksApi(transport),
        state,
        2,
      ),
      (e: unknown) =>
        e instanceof ApiError &&
        e.code === (fault === "read" ? "network" : "revision_review_changed"),
    );
  }
});

test("pre-review receipt is acceptance without a formal version and survives original recovery", async () => {
  const { checkedResult } = await import("../src/api/publications.ts");
  const accepted = {
    work_id: workId,
    version: 0 as const,
    published_at: null,
    review_status: "pre_review" as const,
    submission_id: randomUUID(),
    submitted_at: "2026-11-02T00:00:00Z",
  };
  assert.equal(checkedResult(accepted).version, 0);
  checkedPreview({ ...preview(), published: accepted });
  for (const bad of [
    { ...accepted, version: 1 },
    { ...accepted, published_at: "2026-11-02T00:00:00Z" },
    { ...accepted, submission_id: undefined },
    { ...accepted, submitted_at: undefined },
  ])
    assert.throws(
      () => checkedResult(bad as any),
      (e) => e instanceof ApiError && e.code === "contract",
    );
  let posts = 0;
  const client = api(async (path, options) => {
    if (options?.method === "POST") {
      posts++;
      return accepted;
    }
    return { ...preview(), published: accepted };
  });
  const body = {
    mutation_id: randomUUID(),
    preview_id: previewId,
    expected_version: 0,
  };
  let raw: string | null = JSON.stringify({
    v: 1,
    account_id: account,
    draft_id: draft,
    source_revision: 1,
    request: body,
  });
  const store: JournalStore = {
    get: async () => raw,
    set: async (value) => {
      raw = value;
    },
    remove: async () => {
      raw = null;
    },
  };
  const flow = new PublicationFlow(
    client,
    store,
    account,
    () => true,
    randomUUID,
  );
  await flow.restore();
  assert.equal(flow.result?.review_status, "pre_review");
  assert.equal(posts, 0);
});

test("withdrawal persists minimal account-bound request before send and restores by GET only", async () => {
  const { WorkSubmissionsApi, WorkSubmissionWithdrawal } = await import(
    "../src/publication/submissions.ts"
  );
  const sub = randomUUID(),
    mutation = randomUUID();
  let raw: string | null = null,
    failSave = true,
    current = true,
    drop = true;
  const writes: any[] = [];
  let gets = 0;
  const store: JournalStore = {
    get: async () => raw,
    set: async (value) => {
      if (failSave) throw new ApiError("storage");
      raw = value;
    },
    remove: async () => {
      raw = null;
    },
  };
  const transport: Transport = async <T>(
    path: string,
    options?: Parameters<Transport>[1],
  ) => {
    if (options?.method === "POST") {
      writes.push(options.body);
      if (drop) {
        drop = false;
        throw new ApiError("network");
      }
    } else gets++;
    return {
      work_id: workId,
      submission_id: sub,
      mutation_id: mutation,
      state: "withdrawn",
      version: 0,
    } as T;
  };
  const client = new WorkSubmissionsApi(transport),
    action = new WorkSubmissionWithdrawal(
      account,
      store,
      client,
      () => current,
      () => mutation,
    ),
    item = { id: sub, work_id: workId } as any;
  await assert.rejects(action.start(item));
  assert.equal(writes.length, 0);
  failSave = false;
  await assert.rejects(action.start(item));
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(raw!).state, "unknown");
  assert.equal(Object.keys(JSON.parse(raw!)).length, 6);
  const restored = new WorkSubmissionWithdrawal(
    account,
    store,
    client,
    () => current,
    randomUUID,
  );
  await restored.restore();
  await restored.confirm();
  assert.equal(gets, 1);
  assert.equal(writes.length, 1);
  assert.equal(restored.record?.state, "done");
  await restored.clear();
  assert.equal(raw, null);
  raw = JSON.stringify({
    v: 1,
    owner: account,
    submission: sub,
    work: workId,
    mutation,
    state: "unknown",
    content: "must not be persisted",
  });
  await assert.rejects(
    restored.restore(),
    (e) => e instanceof ApiError && e.code === "storage",
  );
  raw = JSON.stringify({
    v: 1,
    owner: account,
    submission: sub,
    work: workId,
    mutation,
    state: "unknown",
  });
  await assert.rejects(
    new WorkSubmissionWithdrawal(
      randomUUID(),
      store,
      client,
      () => true,
      randomUUID,
    ).restore(),
  );
  current = false;
  await assert.rejects(
    restored.confirm(),
    (e) => e instanceof ApiError && e.code === "stale_session",
  );
  assert.equal(writes.length, 1);
});

test("withdrawal conflict is explicit, unknown or wrong receipts cannot silently clear original request", async () => {
  const { WorkSubmissionsApi, WorkSubmissionWithdrawal } = await import(
    "../src/publication/submissions.ts"
  );
  let raw: string | null = null,
    conflict = true;
  const sub = randomUUID(),
    mutation = randomUUID();
  const store: JournalStore = {
    get: async () => raw,
    set: async (value) => {
      raw = value;
    },
    remove: async () => {
      raw = null;
    },
  };
  const client = new WorkSubmissionsApi(async <T>() => {
    if (conflict) throw new ApiError("review_conflict", "", 409);
    return {
      work_id: randomUUID(),
      submission_id: sub,
      mutation_id: mutation,
      state: "withdrawn",
      version: 0,
    } as T;
  });
  const action = new WorkSubmissionWithdrawal(
    account,
    store,
    client,
    () => true,
    () => mutation,
  );
  await assert.rejects(action.start({ id: sub, work_id: workId } as any));
  assert.equal(action.record?.state, "rejected");
  await action.clear();
  assert.equal(raw, null);
  conflict = false;
  await assert.rejects(
    action.start({ id: sub, work_id: workId } as any),
    (e) => e instanceof ApiError && e.code === "contract",
  );
  assert.equal(action.record?.state, "unknown");
  await assert.rejects(action.clear());
  assert.notEqual(raw, null);
});
