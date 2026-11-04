import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DraftRepository } from "../src/drafts/storage.ts";
import { DraftSynchronizer, type DraftIdentity } from "../src/drafts/sync.ts";
import { ApiError } from "../src/api/client.ts";
import { DraftError } from "../src/drafts/model.ts";
import { fixture, TestApi } from "./helpers/drafts.ts";
import {
  ChapterPublicationApi,
  checkedChapterReceipt,
  checkedChapterPreview,
  type ChapterPreview,
  type ChapterReceipt,
} from "../src/novels/chapters/publication-api.ts";
import {
  NovelManagementApi,
  checkedVisibilityReceipt,
  checkedMetadataReceipt,
  type NovelVisibilityReceipt,
  type NovelMetadataReceipt,
} from "../src/novels/management-api.ts";
import {
  NovelGovernanceApi,
  checkedAppealResult,
  type NovelCaseResult,
} from "../src/novels/governance-api.ts";

test("N2复核客户端：原标识只读确认，处置ID和复核ID明确区分且跨书回执拒绝", async () => {
  const book = randomUUID(),
    input = {
      mutation_id: randomUUID(),
      expected_revision: 2,
      reason: "核对原文",
    };
  const receipt: NovelCaseResult = {
    operation: "appeal",
    novel_id: book,
    case_id: 11,
    id: 99,
    state: "pending",
    revision: 2,
  };
  const calls: { path: string; method?: string }[] = [];
  const api = new NovelGovernanceApi(
    async <T>(path: string, options?: { method?: string }) => {
      calls.push({ path, method: options?.method });
      return receipt as T;
    },
  );
  assert.equal((await api.confirmAppeal(book, 11, input)).id, 99);
  assert.deepEqual(calls, [
    {
      path: `/my/novels/${book}/moderation-requests/${input.mutation_id}`,
      method: undefined,
    },
  ]);
  for (const value of [
    { ...receipt, case_id: 12 },
    { ...receipt, novel_id: randomUUID() },
    { ...receipt, operation: "revoke" },
    { ...receipt, revision: 3 },
  ]) {
    assert.throws(
      () => checkedAppealResult(value as NovelCaseResult, book, 11, input),
      (e) => e instanceof ApiError && e.code === "contract",
    );
  }
});

test("N2管理客户端：矛盾隐藏/恢复回执不能确认操作，跨章回执拒绝", () => {
  const book = randomUUID(),
    chapter = randomUUID(),
    mutation = randomUUID();
  const input = {
    mutation_id: mutation,
    expected_revision: 2,
    action: "hide" as const,
  };
  const receipt: NovelVisibilityReceipt = {
    mutation_id: mutation,
    novel_id: book,
    chapter_id: chapter,
    action: "hide",
    state_revision: 3,
    author_hidden: true,
    platform_limited: false,
    display_version: 1,
  };
  assert.equal(
    checkedVisibilityReceipt(receipt, book, chapter, input).state_revision,
    3,
  );
  for (const bad of [
    { ...receipt, author_hidden: false },
    { ...receipt, chapter_id: randomUUID() },
    { ...receipt, state_revision: 4 },
    { ...receipt, action: "restore", author_hidden: false },
  ]) {
    assert.throws(
      () =>
        checkedVisibilityReceipt(
          bad as NovelVisibilityReceipt,
          book,
          chapter,
          input,
        ),
      (e) => e instanceof ApiError && e.code === "contract",
    );
  }
});
test("N2资料客户端：未知结果只GET原记录，不能将待审当正式成功或接受另一来源", async () => {
  const book = randomUUID(),
    mutation = randomUUID(),
    submission = randomUUID(),
    calls: { path: string; method?: string }[] = [];
  const input = {
    mutation_id: mutation,
    source_revision: 5,
    expected_revision: 2,
    rights_confirmed: true as const,
  };
  const receipt: NovelMetadataReceipt = {
    mutation_id: mutation,
    novel_id: book,
    submission_id: submission,
    operation: "submit_metadata",
    state: "pending",
    revision: 0,
    candidate_revision: 3,
    source_revision: 5,
  };
  const api = new NovelManagementApi(
    async <T>(path: string, options?: { method?: string }) => {
      calls.push({ path, method: options?.method });
      return receipt as T;
    },
  );
  assert.equal((await api.confirmMetadata(book, input)).state, "pending");
  assert.deepEqual(calls, [
    {
      path: `/my/novels/${book}/metadata-requests/${mutation}`,
      method: undefined,
    },
  ]);
  assert.throws(
    () =>
      checkedMetadataReceipt(
        { ...receipt, revision: 3 },
        book,
        mutation,
        "submit_metadata",
      ),
    (e) => e instanceof ApiError && e.code === "contract",
  );
  const wrong = new NovelManagementApi(
    async <T>() => ({ ...receipt, source_revision: 6 }) as T,
  );
  await assert.rejects(
    wrong.confirmMetadata(book, input),
    (e) => e instanceof ApiError && e.code === "contract",
  );
});
test("N2本人版本客户端：受限正文可读取，但不能接受跨书正文或重复版本页", async () => {
  const book = randomUUID(),
    chapter = randomUUID();
  const version = {
    novel_id: book,
    chapter_id: chapter,
    version: 1,
    title: "正式章",
    content: "受限本人内容",
    platform_limited: true,
    published_at: new Date().toISOString(),
  };
  const own = new NovelManagementApi(async <T>() => version as T);
  assert.equal((await own.version(book, chapter, 1)).platform_limited, true);
  const wrong = new NovelManagementApi(
    async <T>() => ({ ...version, novel_id: randomUUID() }) as T,
  );
  await assert.rejects(
    wrong.version(book, chapter, 1),
    (e) => e instanceof ApiError && e.code === "contract",
  );
  const duplicate = new NovelManagementApi(
    async <T>() => ({ items: [version, version], next_before: 0 }) as T,
  );
  await assert.rejects(
    duplicate.versions(book, chapter),
    (e) => e instanceof ApiError && e.code === "contract",
  );
});

function chapterPublicationFixture() {
  const book = randomUUID(),
    chapter = randomUUID(),
    preview = randomUUID(),
    mutation = randomUUID(),
    submission = randomUUID();
  const snapshot: ChapterPreview = {
    id: preview,
    novel_id: book,
    chapter_id: chapter,
    draft_id: randomUUID(),
    source_revision: 1,
    title: "第一章",
    content: "真实传输另行验收",
    book_title: "长文",
    introduction: "",
    tags: ["冒险"],
    ordinal: 1,
    reserved: false,
    expected_last_position: 0,
    expected_version: 0,
    candidate_version: 1,
    review_required: true,
    book_hidden: false,
    chapter_hidden: false,
    restricted: false,
    expires_at: new Date().toISOString(),
  };
  const receipt: ChapterReceipt = {
    mutation_id: mutation,
    operation: "submit",
    novel_id: book,
    chapter_id: chapter,
    preview_id: preview,
    submission_id: submission,
    ordinal: 1,
    state: "pending",
    version: 0,
    accepted_at: new Date().toISOString(),
  };
  return { book, chapter, preview, mutation, submission, snapshot, receipt };
}
test("N2客户端：待审不是正式版，回执按账号传输的书、原标识及预览精确核对", async () => {
  const f = chapterPublicationFixture(),
    calls: string[] = [];
  const api = new ChapterPublicationApi(async <T>(path: string) => {
    calls.push(path);
    return f.receipt as T;
  });
  const result = await api.submit(
    f.book,
    { mutation_id: f.mutation, preview_id: f.preview, rights_confirmed: true },
    f.snapshot,
  );
  assert.equal(result.state, "pending");
  assert.equal(result.version, 0);
  assert.deepEqual(calls, [`/my/novels/${f.book}/chapter-submissions`]);
  const expected = {
    novel: f.book,
    mutation: f.mutation,
    operation: "submit" as const,
    preview: f.preview,
  };
  for (const bad of [
    { ...f.receipt, novel_id: randomUUID() },
    { ...f.receipt, mutation_id: randomUUID() },
    { ...f.receipt, preview_id: randomUUID() },
    { ...f.receipt, state: "published", version: 0 },
    { ...f.receipt, state: "pending", version: 1 },
    { ...f.receipt, submission_id: null },
  ]) {
    assert.throws(
      () => checkedChapterReceipt(bad as ChapterReceipt, expected),
      (e) => e instanceof ApiError && e.code === "contract",
    );
  }
  const wrong = new ChapterPublicationApi(
    async <T>() => ({ ...f.receipt, ordinal: 2 }) as T,
  );
  await assert.rejects(
    wrong.submit(
      f.book,
      {
        mutation_id: f.mutation,
        preview_id: f.preview,
        rights_confirmed: true,
      },
      f.snapshot,
    ),
    (e) => e instanceof ApiError && e.code === "contract",
  );
});
test("N2客户端：冻结正文和预约关系校验，跨书或不同来源不作为可确认预览", async () => {
  const f = chapterPublicationFixture();
  assert.equal(
    checkedChapterPreview(f.snapshot, f.book, f.preview).source_revision,
    1,
  );
  for (const bad of [
    { ...f.snapshot, novel_id: randomUUID() },
    { ...f.snapshot, ordinal: 2 },
    { ...f.snapshot, candidate_version: 2 },
    { ...f.snapshot, content: " " },
    { ...f.snapshot, reserved: true, expected_last_position: 0 },
    { ...f.snapshot, book_title: "" },
  ]) {
    assert.throws(
      () => checkedChapterPreview(bad, f.book, f.preview),
      (e) => e instanceof ApiError && e.code === "contract",
    );
  }
  const api = new ChapterPublicationApi(async <T>() => f.snapshot as T);
  await assert.rejects(
    api.preview(f.book, f.preview, { draft: randomUUID(), revision: 1 }),
    (e) => e instanceof ApiError && e.code === "contract",
  );
});
test("N2客户端：查原回执只读，不重发；记录列表重复或详情目标矛盾则拒绝", async () => {
  const f = chapterPublicationFixture(),
    calls: { path: string; method?: string }[] = [];
  const api = new ChapterPublicationApi(
    async <T>(path: string, options?: { method?: string }) => {
      calls.push({ path, method: options?.method });
      return f.receipt as T;
    },
  );
  await api.receipt({
    novel: f.book,
    mutation: f.mutation,
    operation: "submit",
    preview: f.preview,
  });
  assert.deepEqual(calls, [
    {
      path: `/my/novels/${f.book}/publication-requests/${f.mutation}`,
      method: undefined,
    },
  ]);
  const item = {
    id: f.submission,
    novel_id: f.book,
    chapter_id: f.chapter,
    preview_id: f.preview,
    title: f.snapshot.title,
    ordinal: 1,
    candidate_version: 1,
    state: "pending",
    current: true,
    reason: "",
    submitted_at: new Date().toISOString(),
    decided_at: null,
  };
  const duplicate = new ChapterPublicationApi(
    async <T>() => ({ items: [item, item], next_cursor: "" }) as T,
  );
  await assert.rejects(
    duplicate.list(f.book),
    (e) => e instanceof ApiError && e.code === "contract",
  );
  const mismatch = new ChapterPublicationApi(
    async <T>() =>
      ({
        submission: { ...item, chapter_id: randomUUID() },
        preview: f.snapshot,
      }) as T,
  );
  await assert.rejects(
    mismatch.detail(f.book, f.submission),
    (e) => e instanceof ApiError && e.code === "contract",
  );
});

async function setup(ctx: { after(fn: () => void): void }) {
  const f = await fixture();
  ctx.after(f.close);
  const owner = randomUUID(),
    key = randomUUID(),
    api = new TestApi(owner);
  let identity: DraftIdentity = { owner, generation: 1, online: true };
  const worker = (repo = f.repo) =>
    new DraftSynchronizer(repo, api, () => identity, randomUUID);
  await f.repo.create(owner, key, "合成", "首份草稿");
  return {
    ...f,
    owner,
    key,
    api,
    worker,
    changeIdentity: (v: DraftIdentity) => {
      identity = v;
    },
  };
}

test("先持久化原请求再发；丢响应重开后只创建一份，新输入不被旧回执确认", async (ctx) => {
  const f = await setup(ctx);
  f.api.dropNext = true;
  assert.equal((await f.worker().sync(f.owner, f.key)).state, "pending");
  const old = (await f.repo.load(f.owner, f.key))!;
  assert.ok(old.pending);
  await f.repo.edit(f.owner, f.key, old.seq, "合成", "首次请求后继续写");
  const reopened = new DraftRepository(f.rows, f.cipher);
  const result = await f.worker(reopened).sync(f.owner, f.key);
  assert.equal(result.state, "pending");
  assert.equal(f.api.receipts.size, 1);
  assert.equal(
    f.api.calls[0].body.mutation_id,
    f.api.calls[1].body.mutation_id,
  );
  assert.ok(result.record?.content === "首次请求后继续写");
  assert.equal((await f.worker().sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.drafts.size, 1);
});

test("原请求落盘失败不发网络；服务确认后本机提交失败重试不重复写", async (ctx) => {
  const f = await setup(ctx);
  f.db.failBeforeCommit = true;
  await assert.rejects(f.worker().sync(f.owner, f.key), DraftError);
  assert.equal(f.api.calls.length, 0);
  f.api.beforeReceipt = async () => {
    f.db.failBeforeCommit = true;
    f.api.beforeReceipt = null;
  };
  await assert.rejects(f.worker().sync(f.owner, f.key), DraftError);
  assert.ok((await f.repo.load(f.owner, f.key))?.pending);
  assert.equal((await f.worker().sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.receipts.size, 1);
});

test("保存期间远端先改，409 后持久化唯一恢复请求，副本丢响应仍唯一", async (ctx) => {
  const f = await setup(ctx),
    sync = f.worker();
  await sync.sync(f.owner, f.key);
  const initial = (await f.repo.load(f.owner, f.key))!;
  await f.repo.edit(f.owner, f.key, initial.seq, "合成", "手机离线内容");
  const originalRead = f.api.read.bind(f.api);
  f.api.read = async (id) => {
    const old = await originalRead(id);
    f.api.drafts.set(id, {
      ...old,
      revision: old.revision + 1,
      content: "远端新文字",
    });
    return old;
  };
  f.api.dropNext = true;
  assert.equal((await sync.sync(f.owner, f.key)).state, "pending");
  assert.equal((await f.repo.load(f.owner, f.key))?.pending?.kind, "recover");
  f.api.read = originalRead;
  const result = await sync.sync(f.owner, f.key);
  assert.equal(result.state, "recovered");
  assert.notEqual(result.record?.serverId, initial.serverId);
  assert.ok(f.api.drafts.get(initial.serverId!)?.content === "远端新文字");
  assert.equal(f.api.drafts.size, 2);
  assert.equal(
    f.api.calls.filter((x) => x.kind === "recover")[0].body.mutation_id,
    f.api.calls.filter((x) => x.kind === "recover")[1].body.mutation_id,
  );
});

test("已知远端新版直接另存；恢复期间新增输入保留且副本可继续同步", async (ctx) => {
  const f = await setup(ctx),
    sync = f.worker();
  await sync.sync(f.owner, f.key);
  const old = (await f.repo.load(f.owner, f.key))!;
  await f.repo.edit(f.owner, f.key, old.seq, "合成", "手机版本");
  const remote = f.api.drafts.get(old.serverId!)!;
  f.api.drafts.set(old.serverId!, {
    ...remote,
    revision: remote.revision + 1,
    content: "电脑版本",
  });
  f.api.beforeReceipt = async () => {
    const current = (await f.repo.load(f.owner, f.key))!;
    await f.repo.edit(f.owner, f.key, current.seq, "合成", "恢复请求后继续写");
    f.api.beforeReceipt = null;
  };
  const result = await sync.sync(f.owner, f.key);
  assert.equal(result.state, "recovered");
  assert.equal(result.record?.dirty, true);
  assert.ok(result.record?.content === "恢复请求后继续写");
  assert.equal((await sync.sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.drafts.size, 2);
});

test("离线/账号不符不发送，切号后的迟到回执不能确认或清空原输入", async (ctx) => {
  const f = await setup(ctx),
    sync = f.worker();
  f.changeIdentity({ owner: f.owner, generation: 1, online: false });
  assert.equal((await sync.sync(f.owner, f.key)).state, "login-required");
  assert.equal(f.api.calls.length, 0);
  f.changeIdentity({ owner: randomUUID(), generation: 2, online: true });
  assert.equal((await sync.sync(f.owner, f.key)).state, "account-mismatch");
  f.changeIdentity({ owner: f.owner, generation: 3, online: true });
  f.api.beforeReceipt = async () => {
    f.changeIdentity({ owner: randomUUID(), generation: 4, online: true });
  };
  assert.equal((await sync.sync(f.owner, f.key)).state, "account-mismatch");
  const preserved = (await f.repo.load(f.owner, f.key))!;
  assert.ok(
    preserved.pending && preserved.dirty && preserved.content === "首份草稿",
  );
  f.api.beforeReceipt = null;
  f.changeIdentity({ owner: f.owner, generation: 5, online: true });
  assert.equal((await sync.sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.receipts.size, 1);
});

test("401/503/限频保留冻结请求，明确输入拒绝后允许修改再提交", async (ctx) => {
  const f = await setup(ctx),
    sync = f.worker();
  for (const [error, state] of [
    [new ApiError("authentication_required", "", 401), "login-required"],
    [new ApiError("service_unavailable", "", 503), "pending"],
    [new ApiError("rate_limited", "", 429), "pending"],
  ] as const) {
    f.api.fail = error;
    assert.equal((await sync.sync(f.owner, f.key)).state, state);
    assert.ok((await f.repo.load(f.owner, f.key))?.pending);
  }
  f.api.fail = new ApiError("invalid_input", "", 400);
  assert.equal((await sync.sync(f.owner, f.key)).state, "rejected");
  assert.equal((await f.repo.load(f.owner, f.key))?.pending, null);
  f.api.fail = null;
  assert.equal((await sync.sync(f.owner, f.key)).state, "saved");
});

test("错误修订回执不确认保存；提交互斥阻止同实例重复发送", async (ctx) => {
  const f = await setup(ctx),
    sync = f.worker();
  const write = f.api.write.bind(f.api);
  f.api.write = async (pending) => ({ ...(await write(pending)), revision: 7 });
  assert.equal((await sync.sync(f.owner, f.key)).state, "pending");
  assert.ok((await f.repo.load(f.owner, f.key))?.pending);
  f.api.write = write;
  let release!: () => void, arrived!: () => void;
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.api.beforeReceipt = async () => {
    arrived();
    await gate;
  };
  const operation = sync.sync(f.owner, f.key);
  await ready;
  assert.equal((await sync.sync(f.owner, f.key)).state, "busy");
  release();
  assert.equal((await operation).state, "saved");
  assert.equal(f.api.drafts.size, 1);
});

test("401 同时使会话失效时仍返回重新登录，保留私稿不读取另一账号", async (ctx) => {
  const f = await setup(ctx),
    sync = f.worker();
  f.api.write = async () => {
    f.changeIdentity({ owner: null, generation: 2, online: false });
    throw new ApiError("authentication_required", "", 401);
  };
  assert.equal((await sync.sync(f.owner, f.key)).state, "login-required");
  assert.ok((await f.repo.load(f.owner, f.key))?.pending);
});

test("双同步器旧读取：另一个已确认的 clean 记录不能再生成多余恢复副本", async (ctx) => {
  const f = await setup(ctx),
    fast = f.worker();
  await fast.sync(f.owner, f.key);
  const initial = (await f.repo.load(f.owner, f.key))!;
  await f.repo.edit(f.owner, f.key, initial.seq, "合成", "双实例待确认文字");
  let arrived: () => void = () => {},
    release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = new DraftSynchronizer(
    f.repo,
    {
      me: () => f.api.me(),
      read: async (id) => {
        const result = await f.api.read(id);
        arrived();
        await gate;
        return result;
      },
      write: (pending) => f.api.write(pending),
    },
    () => ({ owner: f.owner, generation: 1, online: true }),
    randomUUID,
  );
  const late = slow.sync(f.owner, f.key);
  await ready;
  assert.equal((await fast.sync(f.owner, f.key)).state, "saved");
  release();
  assert.equal((await late).state, "saved");
  const final = (await f.repo.load(f.owner, f.key))!;
  assert.equal(f.api.drafts.size, 1);
  assert.equal(final.serverId, initial.serverId);
  assert.equal(final.dirty, false);
});

test("双同步器旧读取：已有恢复与新编辑时不得依据旧身份再恢复一次", async (ctx) => {
  const f = await setup(ctx),
    fast = f.worker();
  await fast.sync(f.owner, f.key);
  const initial = (await f.repo.load(f.owner, f.key))!;
  await f.repo.edit(f.owner, f.key, initial.seq, "合成", "第一次离线文字");
  let arrived: () => void = () => {},
    release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = new DraftSynchronizer(
    f.repo,
    {
      me: () => f.api.me(),
      read: async (id) => {
        const result = await f.api.read(id);
        arrived();
        await gate;
        return result;
      },
      write: (pending) => f.api.write(pending),
    },
    () => ({ owner: f.owner, generation: 1, online: true }),
    randomUUID,
  );
  const late = slow.sync(f.owner, f.key);
  await ready;
  const old = f.api.drafts.get(initial.serverId!)!;
  f.api.drafts.set(old.id, {
    ...old,
    revision: old.revision + 1,
    content: "远端改动",
  });
  const recovered = await fast.sync(f.owner, f.key);
  assert.equal(recovered.state, "recovered");
  await f.repo.edit(
    f.owner,
    f.key,
    recovered.record!.seq,
    "合成",
    "恢复后继续写",
  );
  release();
  assert.equal((await late).state, "pending");
  assert.equal(f.api.drafts.size, 2);
  const pending = (await f.repo.load(f.owner, f.key))!;
  assert.equal(pending.serverId, recovered.record!.serverId);
  assert.equal(pending.dirty, true);
  assert.equal(pending.pending, null);
  assert.equal((await fast.sync(f.owner, f.key)).state, "saved");
  assert.equal(f.api.drafts.size, 2);
});

async function editorFixture(ctx: { after(fn: () => void): void }) {
  const f = await setup(ctx);
  const { AuthorizedDrafts } = await import("../src/drafts/authorized.ts");
  const { DraftEditor } = await import("../src/drafts/workspace.ts");
  const { DraftsApi } = await import("../src/drafts/api.ts");
  let current = {
    drafts: {
      phase: "online" as "online" | "offline" | "locked",
      owner: f.owner as string | null,
    },
    generation: 1,
    busy: false,
  };
  const local = new AuthorizedDrafts(
      async () => f.repo,
      () => current,
    ),
    worker = f.worker();
  const tools = {
    local,
    api: new DraftsApi(async () => {
      throw new Error("unused_in_editor");
    }),
    current: () => current,
    online: async () => current.drafts.phase === "online",
    sync: (key: string) => worker.sync(f.owner, key),
    uuid: randomUUID,
  };
  const editor = new DraftEditor(f.owner, f.key, tools);
  await editor.load();
  return {
    ...f,
    local,
    tools,
    editor,
    setIdentity: (value: typeof current) => {
      current = value;
    },
  };
}

test("编辑器：加密暂存期间继续输入，最终落盘最新输入而不反写旧文本", async (ctx) => {
  const f = await editorFixture(ctx);
  const seal = f.cipher.seal.bind(f.cipher);
  let arrived: () => void = () => {},
    release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  f.cipher.seal = async (...args) => {
    if (first) {
      first = false;
      arrived();
      await gate;
    }
    return seal(...args);
  };
  f.editor.input("首次输入", "中文😀");
  await ready;
  f.editor.input("后来输入", "完整的最新文字😀");
  release();
  await f.editor.save();
  assert.equal(f.editor.hasUnstored(), false);
  assert.equal(f.editor.snapshot().content, "完整的最新文字😀");
  assert.equal(
    (await f.repo.load(f.owner, f.key))?.content,
    "完整的最新文字😀",
  );
  assert.equal(f.api.calls.length, 0);
});

test("编辑器：暂存失败保留输入与旧有效记录，重试与提交信号丢失读回", async (ctx) => {
  const f = await editorFixture(ctx);
  f.db.failBeforeCommit = true;
  f.editor.input("失败合成", "不能丢掉的输入");
  await assert.rejects(f.editor.save());
  assert.equal(f.editor.hasUnstored(), true);
  assert.equal(f.editor.snapshot().content, "不能丢掉的输入");
  assert.equal((await f.repo.load(f.owner, f.key))?.content, "首份草稿");
  await f.editor.save();
  assert.equal(f.editor.hasUnstored(), false);
  f.db.failAfterCommit = true;
  f.editor.input("读回合成", "已经提交但回执丢失");
  await f.editor.save();
  assert.equal(f.editor.hasUnstored(), false);
  assert.equal(
    (await f.repo.load(f.owner, f.key))?.content,
    "已经提交但回执丢失",
  );
});

test("编辑器：服务回执期间新输入不被确认，下一次同步仍只写同一稿", async (ctx) => {
  const f = await editorFixture(ctx);
  const { editorStatus } = await import("../src/drafts/workspace.ts");
  let arrived: () => void = () => {},
    release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.api.beforeReceipt = async () => {
    f.api.beforeReceipt = null;
    arrived();
    await gate;
  };
  const syncing = f.editor.synchronize();
  await ready;
  f.editor.input("新输入", "服务请求之后继续写");
  await f.editor.save();
  release();
  await syncing;
  assert.equal(f.editor.snapshot().content, "服务请求之后继续写");
  assert.notEqual(editorStatus(f.editor.snapshot()), "已保存到服务器");
  await f.editor.synchronize();
  assert.equal(editorStatus(f.editor.snapshot()), "已保存到服务器");
  assert.equal(f.api.drafts.size, 1);
});

test("编辑器：离线保存、锁定后的迟到输入拒绝，原账号恢复仍保留未存输入", async (ctx) => {
  const f = await editorFixture(ctx);
  f.setIdentity({
    drafts: { phase: "offline", owner: f.owner },
    generation: 1,
    busy: false,
  });
  f.editor.input("离线", "离线仍可存");
  await f.editor.save();
  await assert.rejects(f.editor.synchronize());
  assert.equal(f.api.calls.length, 0);
  f.db.failBeforeCommit = true;
  f.editor.input("未落盘", "原账号暂存失败的输入");
  await assert.rejects(f.editor.save());
  f.setIdentity({
    drafts: { phase: "locked", owner: null },
    generation: 2,
    busy: false,
  });
  f.editor.input("迟到", "不得替换");
  assert.equal(f.editor.snapshot().content, "原账号暂存失败的输入");
  await assert.rejects(f.editor.save());
  f.setIdentity({
    drafts: { phase: "online", owner: f.owner },
    generation: 3,
    busy: false,
  });
  await f.editor.load();
  await f.editor.save();
  assert.equal((await f.local.load(f.key))?.content, "原账号暂存失败的输入");
});

test("编辑器：本机竞争不提升未存输入的基线，明确另存保留双方", async (ctx) => {
  const f = await editorFixture(ctx);
  const initial = f.editor.snapshot().record!;
  await f.repo.edit(
    f.owner,
    f.key,
    initial.seq,
    "另一编辑器",
    "另一份已存输入",
  );
  f.editor.input("当前编辑器", "当前未存输入");
  await assert.rejects(f.editor.save());
  await assert.rejects(f.editor.load());
  const copy = await f.editor.saveAsCopy();
  assert.notEqual(copy, f.key);
  assert.equal((await f.local.load(f.key))?.content, "另一份已存输入");
  assert.equal((await f.local.load(copy))?.content, "当前未存输入");
});

test("服务器缓存：刷新不能覆盖本机脏稿或未确认请求", async (ctx) => {
  const f = await editorFixture(ctx);
  const serverId = randomUUID(),
    server = {
      id: serverId,
      revision: 1,
      saved_at: "2026-11-02T00:00:00Z",
      title: "缓存",
      content: "初次内容",
    };
  const cached = await f.local.cacheServer(server);
  await f.local.edit(serverId, cached.seq, "本机修改", "保留的脏稿");
  await f.local.cacheServer({
    ...server,
    revision: 2,
    content: "服务器新内容",
  });
  assert.equal((await f.local.load(serverId))?.content, "保留的脏稿");
  assert.equal((await f.local.load(serverId))?.baseRevision, 1);
});

test("自动同步只重试暂时错误，不循环提交缺笔名、错误环境或本机冲突", async () => {
  const { automaticSyncAllowed } = await import("../src/drafts/workspace.ts");
  assert.equal(automaticSyncAllowed(null), true);
  for (const code of ["network", "service_unavailable", "rate_limited"])
    assert.equal(automaticSyncAllowed(new ApiError(code)), true);
  for (const code of [
    "nickname_required",
    "invalid_input",
    "environment",
    "contract",
    "authentication_required",
  ])
    assert.equal(automaticSyncAllowed(new ApiError(code)), false);
  assert.equal(automaticSyncAllowed(new DraftError("local_conflict")), false);
});

const draftReadTransport = (fn: (path: string) => Promise<unknown>) =>
  fn as import("../src/auth/session.ts").Transport;
async function publishingEditor(ctx: { after(fn: () => void): void }) {
  const f = await editorFixture(ctx);
  const { DraftsApi } = await import("../src/drafts/api.ts");
  f.tools.api = new DraftsApi(
    draftReadTransport(async (path) => f.api.read(path.split("/").pop()!)),
  );
  await f.editor.synchronize();
  return f;
}

test("发布票据：未同步拒绝；已确认只读核对，路由只含服务器 ID/修订且一次消费", async (ctx) => {
  const f = await editorFixture(ctx);
  assert.equal(f.editor.canPreparePublication(), false);
  await assert.rejects(f.editor.preparePublication());
  assert.equal(f.api.calls.length, 0);
  const { DraftsApi } = await import("../src/drafts/api.ts");
  f.tools.api = new DraftsApi(
    draftReadTransport(async (path) => f.api.read(path.split("/").pop()!)),
  );
  await f.editor.synchronize();
  f.setIdentity({
    drafts: { phase: "offline", owner: f.owner },
    generation: 1,
    busy: false,
  });
  assert.equal(f.editor.canPreparePublication(), false);
  await assert.rejects(f.editor.preparePublication());
  f.setIdentity({
    drafts: { phase: "online", owner: f.owner },
    generation: 1,
    busy: false,
  });
  const before = await f.rows.read(f.owner, f.key),
    writes = f.api.calls.length;
  const ticket = await f.editor.preparePublication();
  assert.equal(
    f.editor.publicationPath(ticket),
    `/publish?draft_id=${ticket.draftId}&source_revision=1`,
  );
  await assert.rejects(async () => f.editor.publicationPath(ticket));
  assert.equal(f.editor.canPreparePublication(), false);
  assert.equal((await f.rows.read(f.owner, f.key))?.revision, before?.revision);
  assert.equal(f.api.calls.length, writes);
  await f.editor.resume();
  assert.equal(f.editor.canPreparePublication(), true);
  assert.equal(f.api.calls.length, writes);
});

test("发布核对期间新输入已暂存也必须拒绝旧票据，不隐式同步/发布", async (ctx) => {
  const f = await publishingEditor(ctx);
  const { DraftsApi } = await import("../src/drafts/api.ts");
  let arrived: () => void = () => {},
    release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.tools.api = new DraftsApi(
    draftReadTransport(async (path) => {
      const result = await f.api.read(path.split("/").pop()!);
      arrived();
      await gate;
      return result;
    }),
  );
  const pending = f.editor.preparePublication(),
    denied = assert.rejects(pending);
  await ready;
  assert.equal(f.editor.canPreparePublication(), false);
  f.editor.input("新的合成输入", "核对中继续写的内容");
  await f.editor.save();
  release();
  await denied;
  assert.equal(f.editor.snapshot().content, "核对中继续写的内容");
  assert.equal(f.editor.snapshot().record?.dirty, true);
  assert.equal(f.api.calls.length, 1);
});

test("恢复副本仍 dirty 不进入发布，再确认最新输入后交接新服务器 ID", async (ctx) => {
  const f = await publishingEditor(ctx),
    initial = f.editor.snapshot().record!;
  const old = f.api.drafts.get(initial.serverId!)!;
  f.api.drafts.set(old.id, {
    ...old,
    revision: old.revision + 1,
    content: "远端新版",
  });
  f.editor.input("本机合成", "需要恢复的内容");
  await f.editor.save();
  let arrived: () => void = () => {},
    release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.api.beforeReceipt = async () => {
    f.api.beforeReceipt = null;
    arrived();
    await gate;
  };
  const syncing = f.editor.synchronize();
  await ready;
  f.editor.input("恢复中继续", "副本请求后新增输入");
  await f.editor.save();
  release();
  await syncing;
  assert.notEqual(f.editor.snapshot().record?.serverId, initial.serverId);
  assert.equal(f.editor.snapshot().record?.dirty, true);
  await assert.rejects(f.editor.preparePublication());
  await f.editor.synchronize();
  const ticket = await f.editor.preparePublication();
  assert.notEqual(ticket.draftId, initial.serverId);
  assert.equal(ticket.draftId, f.editor.snapshot().record?.serverId);
  assert.equal(f.api.drafts.size, 2);
});

test("服务器已到 R2 仍交接已确认 R1，返回只读，不覆盖本机输入或提升基础修订", async (ctx) => {
  const f = await publishingEditor(ctx),
    initial = f.editor.snapshot().record!;
  const old = f.api.drafts.get(initial.serverId!)!;
  f.api.drafts.set(old.id, {
    ...old,
    revision: 2,
    title: "服务器 R2",
    content: "不应自动覆盖的新版",
  });
  const ticket = await f.editor.preparePublication();
  assert.equal(ticket.revision, 1);
  f.editor.publicationPath(ticket);
  await f.editor.resume();
  assert.equal(f.editor.snapshot().record?.baseRevision, 1);
  assert.equal(f.editor.snapshot().content, initial.content);
  assert.equal(f.api.calls.length, 1);
  f.editor.input("返回后新写", "保留的新输入");
  await f.editor.save();
  await f.editor.resume();
  assert.equal(f.editor.snapshot().content, "保留的新输入");
  assert.equal(f.editor.snapshot().record?.dirty, true);
  assert.equal(f.api.calls.length, 1);
});

test("票据读取期间换号拒绝；旧票据在输入变化后也不能用于导航", async (ctx) => {
  const f = await publishingEditor(ctx);
  const ticket = await f.editor.preparePublication();
  f.editor.input("后写", "后写内容");
  await f.editor.save();
  assert.throws(() => f.editor.publicationPath(ticket));
  await f.editor.synchronize();
  const { DraftsApi } = await import("../src/drafts/api.ts");
  let arrived: () => void = () => {},
    release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.tools.api = new DraftsApi(
    draftReadTransport(async (path) => {
      const result = await f.api.read(path.split("/").pop()!);
      arrived();
      await gate;
      return result;
    }),
  );
  const pending = f.editor.preparePublication(),
    denied = assert.rejects(pending);
  await ready;
  f.setIdentity({
    drafts: { phase: "online", owner: randomUUID() },
    generation: 2,
    busy: false,
  });
  release();
  await denied;
  assert.equal(f.editor.canPreparePublication(), false);
});

test("发布核对读失败保留输入，不能自己存一遍或猜最新修订；伪造票据拒绝", async (ctx) => {
  const f = await publishingEditor(ctx),
    writes = f.api.calls.length;
  const { DraftsApi } = await import("../src/drafts/api.ts");
  f.tools.api = new DraftsApi(async () => {
    throw new ApiError("network");
  });
  await assert.rejects(f.editor.preparePublication());
  assert.equal(f.editor.snapshot().content, "首份草稿");
  assert.equal(f.api.calls.length, writes);
  f.tools.api = new DraftsApi(
    draftReadTransport(async (path) => f.api.read(path.split("/").pop()!)),
  );
  const ticket = await f.editor.preparePublication();
  assert.throws(() => f.editor.publicationPath({ ...ticket }));
});

test("返回读取迟到：期间新输入已落盘，也不能将界面回退为旧内容/旧回执", async (ctx) => {
  const f = await publishingEditor(ctx),
    open = f.cipher.open.bind(f.cipher);
  let arrived: () => void = () => {},
    release: () => void = () => {},
    first = true;
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.cipher.open = async (...args) => {
    const result = await open(...args);
    if (first) {
      first = false;
      arrived();
      await gate;
    }
    return result;
  };
  const returning = f.editor.resume();
  await ready;
  f.editor.input("返回后立即输入", "本机已经保存的新文字");
  await f.editor.save();
  const seq = f.editor.snapshot().record!.seq;
  release();
  await returning;
  assert.equal(f.editor.snapshot().content, "本机已经保存的新文字");
  assert.equal(f.editor.snapshot().record?.seq, seq);
  assert.equal(f.editor.snapshot().record?.dirty, true);
  assert.equal(f.api.calls.length, 1);
});

test("编辑器：另存期间继续输入只写副本，完成切换前排空最新输入", async (ctx) => {
  const f = await editorFixture(ctx),
    initial = f.editor.snapshot().record!;
  await f.repo.edit(f.owner, f.key, initial.seq, "另一窗口", "原稿已更新");
  f.editor.input("本窗口", "另存开始的输入");
  await assert.rejects(f.editor.save());
  const create = f.local.create.bind(f.local),
    edit = f.local.edit.bind(f.local);
  let arrived: () => void = () => {},
    release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: string[] = [];
  f.local.create = async (...args) => {
    const row = await create(...args);
    arrived();
    await gate;
    return row;
  };
  f.local.edit = async (...args) => {
    writes.push(args[0]);
    return edit(...args);
  };
  const copying = f.editor.saveAsCopy();
  await ready;
  f.editor.input("另存中继续", "最新中文和表情😀");
  const saving = f.editor.save();
  // Attach a rejection handler before releasing the old implementation's CAS failure.
  const settled = Promise.allSettled([copying, saving]);
  await Promise.resolve();
  release();
  const results = await settled;
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "fulfilled");
  const copy = (results[0] as PromiseFulfilledResult<string>).value;
  assert.equal(f.editor.localId, copy);
  assert.notEqual(copy, f.key);
  assert.ok(writes.length > 0 && writes.every((key) => key === copy));
  assert.equal((await f.local.load(f.key))?.content, "原稿已更新");
  assert.equal((await f.local.load(copy))?.content, "最新中文和表情😀");
  assert.equal(f.editor.hasUnstored(), false);
  assert.equal(f.editor.snapshot().error, null);
  assert.equal(f.api.calls.length, 0);
});

import { chapterDraftsApi } from "../src/novels/chapters/api.ts";
import { ChapterStorage } from "../src/novels/chapters/storage.ts";
import { fixture as chapterFixture } from "./helpers/drafts.ts";
test("N1-B：冲突恢复的新稿继续通过书级入口同步，原稿不覆盖，丢回应不多建章", async (ctx) => {
  const f = await chapterFixture();
  ctx.after(f.close);
  const owner = randomUUID(),
    book = randomUUID(),
    local = randomUUID(),
    source = randomUUID(),
    recovered = randomUUID();
  const storage = new ChapterStorage(f.rows, f.cipher),
    repo = storage.repository(book);
  await storage.cacheBook(owner, { id: book, title: "同步合成书" });
  await repo.create(owner, local, "初稿", "本机新内容");
  await repo.change(owner, local, (row) => ({
    ...row!,
    serverId: source,
    baseRevision: 1,
  }));
  const original = {
    id: source,
    title: "服务器原章",
    content: "另一端已保存",
    revision: 2,
    saved_at: new Date().toISOString(),
  };
  let receipt: unknown = null,
    creates = 0,
    drop = true,
    receivedMutation = "";
  const paths: string[] = [];
  const api = chapterDraftsApi(
    async <T>(
      path: string,
      options?: Parameters<import("../src/auth/session.ts").Transport>[1],
    ) => {
      paths.push(path);
      if (path === "/me") return { id: owner, nickname: "章节作者" } as T;
      if (path === `/my/novels/${book}/chapter-drafts/${source}`)
        return original as T;
      if (path === `/my/novels/${book}/chapter-drafts/recover`) {
        const body = options!.body as { mutation_id: string };
        if (!receipt) {
          creates++;
          receivedMutation = body.mutation_id;
          receipt = {
            draft_id: recovered,
            revision: 1,
            saved_at: new Date().toISOString(),
          };
        } else assert.equal(body.mutation_id, receivedMutation);
        if (drop) {
          drop = false;
          throw new ApiError("network");
        }
        return receipt as T;
      }
      throw new Error("unexpected_route");
    },
    book,
  );
  const identity = () => ({ owner, generation: 1, online: true });
  const first = await new DraftSynchronizer(
    repo,
    api,
    identity,
    randomUUID,
  ).sync(owner, local);
  assert.equal(first.state, "pending");
  assert.equal((await repo.load(owner, local))?.pending?.kind, "recover");
  const second = await new DraftSynchronizer(
    storage.repository(book),
    api,
    identity,
    randomUUID,
  ).sync(owner, local);
  assert.equal(second.state, "recovered");
  assert.equal(second.record?.serverId, recovered);
  assert.equal(second.record?.recoveredFrom, source);
  assert.equal(creates, 1);
  assert.equal(original.content, "另一端已保存");
  assert.equal(
    paths.some((path) => path.startsWith("/drafts")),
    false,
  );
});

test("N1-B：已同步章节也不能领取中篇发布票据，原中篇默认能力不变", async (ctx) => {
  const f = await editorFixture(ctx);
  await f.tools.sync(f.key);
  const { DraftEditor } = await import("../src/drafts/workspace.ts");
  const chapter = new DraftEditor(f.owner, f.key, {
    ...f.tools,
    channel: "chapter",
  });
  await chapter.load();
  assert.equal(chapter.canPreparePublication(), false);
  await assert.rejects(
    chapter.preparePublication(),
    (e) =>
      e instanceof ApiError && e.code === "chapter_publication_unavailable",
  );
  await f.editor.load();
  assert.equal(f.editor.canPreparePublication(), true);
});

import { NovelReadingApi } from "../src/novels/reading-api.ts";
import {
  readingChunks,
  mergeReadingItems,
} from "../src/novels/reading-model.ts";
test("长文阅读分块保留全文、换行和表情；分页不重复追加", () => {
  const content = "文字😀\n\n".repeat(2000) + "尾";
  const chunks = readingChunks(content, 11);
  assert.equal(chunks.join(""), content);
  for (const chunk of chunks) {
    assert.ok(Array.from(chunk).length <= 11);
    assert.ok(!/[\uD800-\uDBFF]$/.test(chunk));
    assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk));
  }
  assert.deepEqual(
    mergeReadingItems(
      [{ id: "a", n: 1 }],
      [
        { id: "a", n: 2 },
        { id: "b", n: 3 },
      ],
    ),
    [
      { id: "a", n: 1 },
      { id: "b", n: 3 },
    ],
  );
  assert.throws(() => readingChunks("text", 0));
});
test("长文目录客户端拒绝不可读标题泄漏、错序和重复章；不要求登录", async () => {
  const book = randomUUID(),
    chapter = randomUUID();
  let items: unknown[] = [
    { id: chapter, ordinal: 2, readable: false, title: null },
  ];
  let calls = 0;
  const api = new NovelReadingApi(
    async <T>(path: string, options?: { token?: string }) => {
      calls++;
      assert.equal(path, `/novels/${book}/directory`);
      assert.equal(options?.token, undefined);
      return { items, next_cursor: "" } as T;
    },
  );
  assert.equal((await api.directory(book)).items[0].title, null);
  for (const bad of [
    [{ id: chapter, ordinal: 2, readable: false, title: "不可泄漏" }],
    [{ id: chapter, ordinal: 2, readable: true, title: "" }],
    [
      { id: chapter, ordinal: 2, readable: true, title: "正文" },
      { id: randomUUID(), ordinal: 1, readable: true, title: "正文" },
    ],
    [
      { id: chapter, ordinal: 2, readable: true, title: "正文" },
      { id: chapter, ordinal: 3, readable: true, title: "正文" },
    ],
  ]) {
    items = bad;
    await assert.rejects(
      api.directory(book),
      (e) => e instanceof ApiError && e.code === "contract",
    );
  }
  assert.equal(calls, 5);
  await assert.rejects(
    api.directory("bad"),
    (e) => e instanceof ApiError && e.code === "invalid_input",
  );
  assert.equal(calls, 5);
});

import {
  ChapterPublisher,
  type ChapterPublicationRecord,
} from "../src/novels/chapters/publisher.ts";
import { EncryptedChapterPublicationJournal } from "../src/novels/chapters/publication-journal.ts";
function publisherFixture() {
  const f = chapterPublicationFixture(),
    receipts = new Map<string, ChapterReceipt>(),
    writes: { path: string; body: unknown }[] = [];
  let drop = "",
    reject: ApiError | null = null,
    expired = false,
    beforeRead: (() => void) | null = null;
  const api = new ChapterPublicationApi(
    async <T>(path: string, options?: { method?: string; body?: unknown }) => {
      if (options?.method === "POST") {
        writes.push({ path, body: options.body });
        const input = options.body as { mutation_id: string };
        if (reject) throw reject;
        const prepared = path.endsWith("chapter-previews");
        const receipt: ChapterReceipt = {
          ...f.receipt,
          mutation_id: input.mutation_id,
          operation: prepared ? "prepare" : "submit",
          state: prepared ? "prepared" : "pending",
          submission_id: prepared ? null : f.submission,
        };
        receipts.set(input.mutation_id, receipt);
        if (drop === (prepared ? "prepare" : "submit")) {
          drop = "";
          throw new ApiError("network");
        }
        return receipt as T;
      }
      beforeRead?.();
      if (path.includes("/publication-requests/")) {
        const receipt = receipts.get(path.split("/").pop()!);
        if (!receipt) throw new ApiError("resource_not_found", "", 404);
        return receipt as T;
      }
      if (expired) throw new ApiError("chapter_preview_expired", "", 410);
      return f.snapshot as T;
    },
  );
  return {
    ...f,
    api,
    receipts,
    writes,
    setDrop: (v: string) => {
      drop = v;
    },
    setReject: (v: ApiError | null) => {
      reject = v;
    },
    expire: () => {
      expired = true;
    },
    onRead: (v: () => void) => {
      beforeRead = v;
    },
  };
}
test("章节发布进程重开仅查原请求；预览过期也能确认已受理提交，不重复发章", async (ctx) => {
  const local = await fixture();
  ctx.after(local.close);
  const f = publisherFixture(),
    owner = randomUUID();
  const journal = () =>
    new EncryptedChapterPublicationJournal(
      local.rows,
      local.cipher,
      owner,
      () => true,
    );
  const create = () =>
    new ChapterPublisher(f.api, journal(), () => true, randomUUID);
  let p = create();
  await p.load();
  f.setDrop("prepare");
  await assert.rejects(
    p.begin(f.book, {
      draft: f.snapshot.draft_id,
      revision: 1,
      bookRevision: 1,
    }),
  );
  await assert.rejects(p.clear());
  assert.equal(f.writes.length, 1);
  p = create();
  await p.load();
  assert.equal(f.writes.length, 1);
  await p.confirmOriginal();
  const preview = await p.readPreview();
  assert.equal(preview.content, f.snapshot.content);
  f.setDrop("submit");
  await assert.rejects(p.submit(preview, true));
  assert.equal(f.writes.length, 2);
  await assert.rejects(p.clear());
  f.expire();
  p = create();
  await p.load();
  const result = await p.confirmOriginal();
  assert.equal(result?.result?.state, "pending");
  assert.equal(f.writes.length, 2);
  assert.ok(
    !JSON.stringify(await journal().load()).includes(f.snapshot.content),
  );
  await p.clear();
  assert.equal(await journal().load(), null);
});
test("章节发布原请求重试不依赖已过期正文；404和断网不能当作未发送而清除", async (ctx) => {
  const local = await fixture();
  ctx.after(local.close);
  const f = publisherFixture(),
    owner = randomUUID();
  const journal = new EncryptedChapterPublicationJournal(
    local.rows,
    local.cipher,
    owner,
    () => true,
  );
  const p = new ChapterPublisher(f.api, journal, () => true, randomUUID);
  await p.load();
  await p.begin(f.book, {
    draft: f.snapshot.draft_id,
    revision: 1,
    bookRevision: 1,
  });
  const preview = await p.readPreview();
  f.setDrop("submit");
  await assert.rejects(p.submit(preview, true));
  const original = f.writes[1];
  f.receipts.clear();
  f.expire();
  await assert.rejects(p.confirmOriginal());
  await assert.rejects(p.clear());
  await p.retryOriginal();
  assert.equal(f.writes.length, 3);
  assert.deepEqual(f.writes[2], original);
  assert.equal(p.snapshot()?.result?.state, "pending");
});
test("发布安全记录写失败不POST；回执写失败重开可恢复，旧控制器CAS不覆盖新状态", async (ctx) => {
  const local = await fixture();
  ctx.after(local.close);
  const f = publisherFixture(),
    owner = randomUUID();
  const journal = new EncryptedChapterPublicationJournal(
    local.rows,
    local.cipher,
    owner,
    () => true,
  );
  const p = new ChapterPublisher(f.api, journal, () => true, randomUUID);
  await p.load();
  local.db.failBeforeCommit = true;
  await assert.rejects(
    p.begin(f.book, {
      draft: f.snapshot.draft_id,
      revision: 1,
      bookRevision: 1,
    }),
  );
  assert.equal(f.writes.length, 0);
  await p.begin(f.book, {
    draft: f.snapshot.draft_id,
    revision: 1,
    bookRevision: 1,
  });
  const old = p.snapshot()!;
  await p.readPreview();
  await assert.rejects(
    journal.save({ ...old, token: randomUUID() }, old.token),
  );
  assert.notEqual((await journal.load())?.token, old.token);
  const second = new ChapterPublisher(f.api, journal, () => true, randomUUID);
  await second.load();
  const snap = await second.readPreview();
  local.db.failAfterCommit = true;
  await assert.rejects(second.submit(snap, true)); // Original command committed, no POST on ambiguous local commit.
  assert.equal(f.writes.length, 1);
  const restart = new ChapterPublisher(f.api, journal, () => true, randomUUID);
  await restart.load();
  await restart.retryOriginal();
  assert.equal(f.writes.length, 2);
  assert.equal(restart.snapshot()?.result?.state, "pending");
});
test("明确409/410拒绝可放弃后重新预览，权限/未知失败保持原标识", async (ctx) => {
  const local = await fixture();
  ctx.after(local.close);
  const f = publisherFixture(),
    owner = randomUUID();
  const journal = new EncryptedChapterPublicationJournal(
      local.rows,
      local.cipher,
      owner,
      () => true,
    ),
    p = new ChapterPublisher(f.api, journal, () => true, randomUUID);
  await p.load();
  f.setReject(new ApiError("chapter_publication_conflict", "", 409));
  await assert.rejects(
    p.begin(f.book, {
      draft: f.snapshot.draft_id,
      revision: 1,
      bookRevision: 1,
    }),
  );
  assert.equal(p.snapshot()?.rejection, "chapter_publication_conflict");
  await p.clear();
  f.setReject(new ApiError("authentication_required", "", 401));
  await assert.rejects(
    p.begin(f.book, {
      draft: f.snapshot.draft_id,
      revision: 1,
      bookRevision: 1,
    }),
  );
  assert.equal(p.snapshot()?.rejection, null);
  await assert.rejects(p.clear());
});
test("发布记录账号/AAD隔离、丢密钥不重建、切号后的迟到响应不能确认", async (ctx) => {
  const local = await fixture();
  ctx.after(local.close);
  const f = publisherFixture(),
    owner = randomUUID(),
    other = randomUUID();
  let current = true;
  const journal = new EncryptedChapterPublicationJournal(
      local.rows,
      local.cipher,
      owner,
      () => current,
    ),
    p = new ChapterPublisher(f.api, journal, () => current, randomUUID);
  await p.load();
  await p.begin(f.book, {
    draft: f.snapshot.draft_id,
    revision: 1,
    bookRevision: 1,
  });
  assert.equal(
    await new EncryptedChapterPublicationJournal(
      local.rows,
      local.cipher,
      other,
      () => true,
    ).load(),
    null,
  );
  f.onRead(() => {
    current = false;
  });
  await assert.rejects(
    p.readPreview(),
    (e) => e instanceof ApiError && e.code === "stale_session",
  );
  current = true;
  assert.equal((await journal.load())?.target, null);
  const before = local.db.raw
    .prepare("SELECT ciphertext FROM private_drafts_v1 WHERE owner=?")
    .get(owner) as { ciphertext: string };
  local.cipher.keys.delete(owner);
  await assert.rejects(journal.load());
  await assert.rejects(
    journal.save(null, (p.snapshot() as ChapterPublicationRecord).token),
  );
  assert.equal(local.cipher.keys.has(owner), false);
  const after = local.db.raw
    .prepare("SELECT ciphertext FROM private_drafts_v1 WHERE owner=?")
    .get(owner) as { ciphertext: string };
  assert.equal(before.ciphertext, after.ciphertext);
});

test("章节交接只领取独立票据，未同步/离线拒绝；来源修订和单次路由保持不变", async (ctx) => {
  const f = await editorFixture(ctx);
  await f.tools.sync(f.key);
  const { DraftEditor } = await import("../src/drafts/workspace.ts");
  const tools = {
    ...f.tools,
    channel: "chapter" as const,
    api: {
      read: async () => ({
        ...f.api.drafts.values().next().value!,
        revision: 2,
      }),
    } as unknown as typeof f.tools.api,
  };
  const editor = new DraftEditor(f.owner, f.key, tools);
  await editor.load();
  assert.equal(editor.canPreparePublication(), false);
  assert.equal(editor.canPrepareChapterPublication(), true);
  const ticket = await editor.prepareChapterPublication();
  assert.equal(ticket.revision, 1);
  const book = randomUUID();
  assert.equal(
    editor.chapterPublicationPath(book, ticket),
    `/chapter-publish?book=${book}&draft=${ticket.draftId}&revision=1&local=${ticket.localId}`,
  );
  assert.throws(() => editor.chapterPublicationPath(book, ticket));
  const changed = new DraftEditor(f.owner, f.key, tools);
  await changed.load();
  changed.input("新输入", "还没同步");
  assert.equal(changed.canPrepareChapterPublication(), false);
  await assert.rejects(changed.prepareChapterPublication());
});

test("所有实际409/410业务拒绝有明确退出；不接受附带正文的安全回执", async (ctx) => {
  const local = await fixture();
  ctx.after(local.close);
  const f = publisherFixture(),
    owner = randomUUID();
  const journal = new EncryptedChapterPublicationJournal(
    local.rows,
    local.cipher,
    owner,
    () => true,
  );
  const p = new ChapterPublisher(f.api, journal, () => true, randomUUID);
  await p.load();
  for (const code of [
    "novel_state_conflict",
    "chapter_publication_conflict",
    "novel_revision_conflict",
    "source_revision_unavailable",
    "novel_restricted",
    "chapter_preview_expired",
  ]) {
    f.setReject(
      new ApiError(code, "", code === "chapter_preview_expired" ? 410 : 409),
    );
    await assert.rejects(
      p.begin(f.book, {
        draft: f.snapshot.draft_id,
        revision: 1,
        bookRevision: 1,
      }),
    );
    assert.equal(p.snapshot()?.rejection, code);
    await p.clear();
  }
  f.setReject(null);
  await p.begin(f.book, {
    draft: f.snapshot.draft_id,
    revision: 1,
    bookRevision: 1,
  });
  const current = (await journal.load())!;
  await assert.rejects(
    journal.save(
      {
        ...current,
        prepared: { ...current.prepared!, content: "不应进入安全记录的正文" },
      } as ChapterPublicationRecord,
      current.token,
    ),
  );
  assert.deepEqual(await journal.load(), current);
});

import {
  NovelOperations,
  type NovelCommand,
} from "../src/novels/management-requests.ts";
import { EncryptedNovelManagementJournal } from "../src/novels/management-journal.ts";
import { NovelChapterCatalogApi } from "../src/novels/management-catalog.ts";
function managementFixture() {
  const book = randomUUID(),
    receipts = new Map<string, unknown>(),
    calls: { path: string; method?: string; body?: unknown }[] = [];
  let drop = false;
  const transport = async <T>(
    path: string,
    options?: { method?: string; body?: unknown },
  ) => {
    calls.push({ path, method: options?.method, body: options?.body });
    if (options?.method === "POST") {
      const input = options.body as {
        mutation_id: string;
        expected_revision: number;
        action: "hide" | "restore";
      };
      const receipt = {
        mutation_id: input.mutation_id,
        novel_id: book,
        chapter_id: null,
        action: input.action,
        state_revision: input.expected_revision + 1,
        author_hidden: input.action === "hide",
        platform_limited: false,
        display_version: 0,
      };
      receipts.set(input.mutation_id, receipt);
      if (drop) {
        drop = false;
        throw new ApiError("network");
      }
      return receipt as T;
    }
    const receipt = receipts.get(path.split("/").pop()!);
    if (!receipt) throw new ApiError("resource_not_found", "", 404);
    return receipt as T;
  };
  return {
    book,
    calls,
    receipts,
    management: new NovelManagementApi(transport),
    publication: new ChapterPublicationApi(transport),
    setDrop: () => {
      drop = true;
    },
  };
}
test("正式管理丢响应重开只GET原操作，确认后清除；旧CAS/存储失败/换号不能改写", async (ctx) => {
  const local = await fixture();
  ctx.after(local.close);
  const f = managementFixture(),
    owner = randomUUID();
  let current = true;
  const journal = new EncryptedNovelManagementJournal(
      local.rows,
      local.cipher,
      owner,
      () => current,
    ),
    make = () =>
      new NovelOperations(
        journal,
        f.management,
        f.publication,
        () => current,
        randomUUID,
      );
  let ops = make();
  await ops.load();
  local.db.failBeforeCommit = true;
  const command: NovelCommand = {
    kind: "visibility",
    book: f.book,
    chapter: null,
    input: { mutation_id: randomUUID(), expected_revision: 1, action: "hide" },
  };
  await assert.rejects(ops.start(command));
  assert.equal(f.calls.length, 0);
  f.setDrop();
  await assert.rejects(ops.start(command));
  const original = (await journal.load())!;
  assert.equal(f.calls.length, 1);
  await assert.rejects(ops.clear());
  ops = make();
  await ops.load();
  assert.equal(f.calls.length, 1);
  await ops.confirm();
  assert.equal(ops.snapshot()?.outcome, "hidden");
  assert.equal(f.calls[1].method, undefined);
  await assert.rejects(journal.save(original, original.token));
  current = false;
  await assert.rejects(
    ops.clear(),
    (e) => e instanceof ApiError && e.code === "stale_session",
  );
  current = true;
  await ops.clear();
  assert.equal(await journal.load(), null);
  const another = new EncryptedNovelManagementJournal(
    local.rows,
    local.cipher,
    randomUUID(),
    () => true,
  );
  assert.equal(await another.load(), null);
});
test("管理原命令只含目标和修订，不能混入正文；404不允许忘记未知操作", async (ctx) => {
  const local = await fixture();
  ctx.after(local.close);
  const f = managementFixture(),
    owner = randomUUID();
  const journal = new EncryptedNovelManagementJournal(
      local.rows,
      local.cipher,
      owner,
      () => true,
    ),
    ops = new NovelOperations(
      journal,
      f.management,
      f.publication,
      () => true,
      randomUUID,
    );
  await ops.load();
  f.setDrop();
  await assert.rejects(
    ops.start({
      kind: "visibility",
      book: f.book,
      chapter: null,
      input: {
        mutation_id: randomUUID(),
        expected_revision: 2,
        action: "restore",
      },
    }),
  );
  const record = (await journal.load())!;
  f.receipts.clear();
  await assert.rejects(ops.confirm());
  await assert.rejects(ops.clear());
  const polluted = {
    ...record,
    command: { ...record.command, content: "不应持久化的正文" },
  };
  await assert.rejects(journal.save(polluted, record.token));
  assert.deepEqual(await journal.load(), record);
  await ops.retry();
  assert.deepEqual(f.calls[0].body, f.calls[2].body);
  assert.equal(ops.snapshot()?.outcome, "restored");
});
test("管理摘要拒绝正式标题来源伪装、正文或状态矛盾；不通过额外正文请求显示列表", async () => {
  const book = randomUUID(),
    chapter = randomUUID();
  let item = {
    novel_id: book,
    chapter_id: chapter,
    ordinal: 1,
    state_revision: 2,
    last_version: 1,
    display_version: 1,
    author_hidden: false,
    platform_limited: false,
    parent_hidden: false,
    parent_limited: false,
    completed: false,
    current_submission_id: null,
    title: "正式标题",
    title_source: "formal",
    pending_title: null,
    draft_id: randomUUID(),
    version_limited: false,
    created_at: new Date().toISOString(),
  };
  const paths: string[] = [];
  const api = new NovelChapterCatalogApi(async <T>(p: string) => {
    paths.push(p);
    return { items: [item], next_cursor: "" } as T;
  });
  assert.equal((await api.list(book)).items[0].title, "正式标题");
  assert.deepEqual(paths, [`/my/novels/${book}/publication-chapters`]);
  const original = item;
  for (const changed of [
    { ...original, title_source: "private" },
    { ...original, pending_title: "并无待审" },
    { ...original, novel_id: randomUUID() },
    { ...original, display_version: 2 },
  ]) {
    item = changed as typeof item;
    await assert.rejects(
      api.list(book),
      (e) => e instanceof ApiError && e.code === "contract",
    );
  }
});

test("逐章提交历史解码保留驳回/撤回，不下载正文且拒绝同书另一章", async () => {
  const f = chapterPublicationFixture();
  let chapter = f.chapter;
  const item = {
    id: f.submission,
    novel_id: f.book,
    chapter_id: chapter,
    preview_id: f.preview,
    title: "被驳回的提交",
    ordinal: 1,
    candidate_version: 1,
    state: "rejected",
    current: false,
    reason: "明确的驳回原因",
    submitted_at: new Date().toISOString(),
    decided_at: new Date().toISOString(),
  };
  const paths: string[] = [];
  const api = new ChapterPublicationApi(async <T>(path: string) => {
    paths.push(path);
    return { items: [{ ...item, chapter_id: chapter }], next_cursor: "" } as T;
  });
  assert.equal(
    (await api.chapterHistory(f.book, f.chapter)).items[0].reason,
    "明确的驳回原因",
  );
  assert.deepEqual(paths, [
    `/my/novels/${f.book}/chapters/${f.chapter}/submissions`,
  ]);
  chapter = randomUUID();
  await assert.rejects(
    api.chapterHistory(f.book, f.chapter),
    (e) => e instanceof ApiError && e.code === "contract",
  );
});

test("author observation is account-scoped, paged and rejects malformed history", async () => {
  const { AuthorPolicyApi } = await import(
    "../src/novels/author-policy-api.ts"
  );
  const book = randomUUID(),
    historicalBook = randomUUID();
  let payload: any = {
    policy: {
      revision: 1,
      active: true,
      observation_until: "2026-11-11T00:00:00Z",
      reason: "已确认问题",
    },
    items: [
      {
        context_id: historicalBook,
        context_kind: "novel",
        mutation_id: randomUUID(),
        action: "start",
        revision: 1,
        reason: "已确认问题",
        previous_until: null,
        observation_until: "2026-11-11T00:00:00Z",
        created_at: "2026-11-04T00:00:00Z",
      },
    ],
    next: 0,
  };
  const paths: string[] = [];
  const api = new AuthorPolicyApi(async <T>(p: string) => {
    paths.push(p);
    return payload as T;
  });
  assert.equal((await api.read(book)).items[0].context_id, historicalBook);
  assert.deepEqual(paths, [`/my/novels/${book}/author-policy`]);
  const baseline = structuredClone(payload);
  for (const invalid of [
    { ...baseline, items: [{ ...baseline.items[0], observation_until: null }] },
    { ...baseline, next: 1 },
    { ...baseline, items: [baseline.items[0], baseline.items[0]] },
    { ...baseline, policy: { ...baseline.policy, observation_until: null } },
  ]) {
    payload = invalid;
    await assert.rejects(
      api.read(book),
      (e) => e instanceof ApiError && e.code === "contract",
    );
  }
  payload = baseline;
  await assert.rejects(
    api.read(book, -1),
    (e) => e instanceof ApiError && e.code === "invalid_input",
  );
});


import { locatedReadingChunks, logicalParagraphs, validReadingLocation, readingChunkIndex } from "../src/novels/reading-location.ts";
test("N3 logical positions survive renderer chunk changes, empty lines and Unicode boundaries", () => {
  const raw = "😀甲乙丙丁\r\n\r\n末尾\r", canonical = "😀甲乙丙丁\n\n末尾\n";
  assert.deepEqual(logicalParagraphs(raw), ["😀甲乙丙丁", "", "末尾", ""]);
  for (const limit of [1, 2, 4, 2000]) {
    const chunks = locatedReadingChunks(raw, limit);
    assert.equal(chunks.map(x => x.text).join(""), canonical);
    assert.ok(chunks.every(x => !/^[\uDC00-\uDFFF]/.test(x.text) && !/[\uD800-\uDBFF]$/.test(x.text)));
    const location = { algorithm: 1 as const, paragraph: 0, offset: 2 };
    assert.equal(validReadingLocation(raw, location), true);
    const chunk = chunks[readingChunkIndex(raw, location, limit)];
    assert.equal(chunk.paragraph, 0);
    assert.ok(chunk.offset <= location.offset && chunk.offset + chunk.length >= location.offset);
  }
  assert.equal(readingChunkIndex("甲乙丙丁", { algorithm: 1, paragraph: 0, offset: 2 }, 2), 1);
  assert.equal(validReadingLocation(raw, { algorithm: 1, paragraph: 1, offset: 0 }), true);
  assert.equal(validReadingLocation(raw, { algorithm: 1, paragraph: 3, offset: 0 }), true);
  assert.equal(validReadingLocation(raw, { algorithm: 1, paragraph: 0, offset: 6 }), false);
  for (const bad of [null, [], { algorithm: 2, paragraph: 0, offset: 0 }, { algorithm: 1, paragraph: 4, offset: 0 }, { algorithm: 1, paragraph: 0, offset: -1 }, { algorithm: 1, paragraph: 0.5, offset: 0 }, { algorithm: 1, paragraph: 0, offset: 0, owner_id: "other" }]) assert.equal(validReadingLocation(raw, bad), false);
  assert.throws(() => readingChunkIndex(raw, { algorithm: 1, paragraph: 0, offset: 6 }), /invalid_reading_location/);
  assert.throws(() => locatedReadingChunks(raw, 0), /invalid_chunk_limit/);
  assert.deepEqual(locatedReadingChunks(""), [{ text: "", paragraph: 0, offset: 0, length: 0 }]);
});


import { ReadingPositionApi } from "../src/novels/reading-position-api.ts";
test("N3 position client rejects mismatched receipts and unsafe availability, does not invent POST after reads", async () => {
  const book = "1ab89897-67ae-4df0-a373-9fab690699a9", chapter = "a0268cfa-85d8-4a46-8fdb-8e6e6a7478e6", mutation = "d9e37090-2468-4242-b9d6-daf1b88d84d0";
  const input = { mutation_id: mutation, base_revision: 2, chapter_id: chapter, version: 1, locator: { algorithm: 1 as const, paragraph: 0, offset: 1 } };
  const p = { novel_id: book, chapter_id: chapter, version: 1, locator: input.locator, revision: 3, saved_at: "2026-11-04T00:00:00Z" };
  let value: unknown = { position: null, readable: false, current_version: null };
  const calls: { path: string; method?: string }[] = [];
  const api = new ReadingPositionApi((async (path, options) => { calls.push({ path, method: options?.method }); return value; }) as import("../src/auth/session.ts").Transport);
  assert.equal((await api.read(book)).position, null);
  value = { position: p, readable: false, current_version: null }; assert.deepEqual((await api.read(book)).position, p);
  value = { position: p, readable: true, current_version: 2 }; assert.equal((await api.read(book)).current_version, 2);
  for (const invalid of [{ position: null, readable: true, current_version: 1 }, { position: p, readable: false, current_version: 1 }, { position: { ...p, novel_id: chapter }, readable: true, current_version: 1 }, { position: p, readable: true, current_version: 0 }, { position: { ...p, locator: { ...p.locator, algorithm: 2 } }, readable: true, current_version: 1 }]) {
    value = invalid; await assert.rejects(api.read(book), e => e instanceof ApiError && e.code === "contract");
  }
  assert.ok(calls.every(c => c.method !== "POST"));
  value = p; assert.deepEqual(await api.save(book, input), p);
  assert.deepEqual(await api.receipt(book, mutation, input), p);
  value = { ...p, revision: 4 }; await assert.rejects(api.save(book, input), e => e instanceof ApiError && e.code === "contract");
  const before = calls.length; await assert.rejects(api.receipt(book, chapter, input)); assert.equal(calls.length, before);
});


import { ReadingSynchronizer, type ReadingCandidate } from "../src/novels/reading-sync.ts";
import { EncryptedReadingJournal } from "../src/novels/reading-journal.ts";
async function readingFixture() {
  const f=await fixture(), owner=randomUUID(),book=randomUUID(),chapter=randomUUID();let current=true,online=true;
  let cloud:import("../src/novels/reading-position-api.ts").ReadingPosition|null=null;
  const receipts=new Map<string,import("../src/novels/reading-position-api.ts").ReadingPosition>(),posts:import("../src/novels/reading-position-api.ts").ReadingWrite[]=[],gets:string[]=[];
  let drop=false,block=false,afterPost:(()=>Promise<void>)|null=null;
  const api=new ReadingPositionApi((async(path:string,options?:{method?:string;body?:unknown})=>{
    if(!current)throw new ApiError("authentication_required","",401);
    if(!online)throw new ApiError("network");
    if(options?.method==="POST"){
      const input=options.body as import("../src/novels/reading-position-api.ts").ReadingWrite;posts.push(structuredClone(input));
      if(block)throw new ApiError("resource_not_found","",404);
      let p=receipts.get(input.mutation_id);
      if(!p){if((cloud?.revision??0)!==input.base_revision)throw new ApiError("reading_position_conflict","",409);
        p={novel_id:book,chapter_id:input.chapter_id,version:input.version,locator:input.locator,revision:input.base_revision+1,saved_at:"2026-11-04T00:00:00Z"};cloud=p;receipts.set(input.mutation_id,p)}
      if(afterPost)await afterPost();
      if(drop){drop=false;throw new ApiError("network")};return p;
    }
    gets.push(path);
    if(path.includes('/requests/')){const p=receipts.get(path.split('/').pop()!);if(!p)throw new ApiError("resource_not_found","",404);return p}
    return {position:cloud,readable:!!cloud,current_version:cloud?.version??null};
  }) as import("../src/auth/session.ts").Transport);
  const journal=()=>new EncryptedReadingJournal(f.rows,f.cipher,owner,()=>current,book);
  const model=()=>new ReadingSynchronizer(owner,book,journal(),api,()=>current,()=>current&&online,randomUUID);
  const candidate=(offset:number):ReadingCandidate=>({chapter_id:chapter,version:1,locator:{algorithm:1,paragraph:0,offset}});
  return {...f,owner,book,chapter,posts,gets,receipts,journal,model,candidate,setOnline:(v:boolean)=>{online=v},setCurrent:(v:boolean)=>{current=v},setDrop:()=>{drop=true},setBlocked:(v:boolean)=>{block=v},setCloud:(v:typeof cloud)=>{cloud=v},setAfterPost:(fn:(()=>Promise<void>)|null)=>{afterPost=fn}};
}
test("N3 encrypted offline positions survive restart and cannot cross owner/book or replace lost keys",async()=>{
 const f=await readingFixture();try{
  f.setOnline(false);const m=f.model();await m.restore();await m.capture(f.candidate(9));
  const raw=await f.rows.read(f.owner,f.book);assert.ok(raw&&!raw.ciphertext.includes('paragraph'));
  const next=f.model();await next.restore();assert.equal(next.snapshot().record?.candidate?.locator.offset,9);assert.equal(f.posts.length,0);
  const other=new EncryptedReadingJournal(f.rows,f.cipher,randomUUID(),()=>true,f.book);assert.equal(await other.load(),null);
  const copy=randomUUID();await f.rows.update(f.owner,copy,async()=>raw!);
  const wrongBook=new EncryptedReadingJournal(f.rows,f.cipher,f.owner,()=>true,copy);await assert.rejects(wrongBook.load());
  f.cipher.keys.delete(f.owner);await assert.rejects(f.model().restore());assert.ok(await f.rows.read(f.owner,f.book));
 }finally{f.close()}
});
test("N3 lost response recovery only queries, preserves newer local position, then explicitly syncs it",async()=>{
 const f=await readingFixture();try{
  const m=f.model();await m.restore();await m.capture(f.candidate(1));f.setDrop();await m.sync();assert.ok(m.snapshot().record?.pending);
  await m.capture(f.candidate(6));const next=f.model();await next.restore();assert.equal(f.posts.length,1);assert.equal(next.snapshot().record?.pending,null);assert.equal(next.snapshot().record?.candidate?.locator.offset,6);
  assert.ok(f.gets.some(x=>x.includes('/requests/')));await next.sync();assert.equal(f.posts.length,2);assert.equal(next.snapshot().record?.candidate,null);assert.equal(next.snapshot().record?.base,2);
 }finally{f.close()}
});
test("N3 CAS conflicts and expired receipts retain local position until an explicit local/cloud choice",async()=>{
 const f=await readingFixture();try{
  const m=f.model();await m.restore();await m.capture(f.candidate(3));f.setDrop();await m.sync();f.receipts.clear();
  const next=f.model();await next.restore();assert.ok(next.snapshot().record?.pending);assert.equal(f.posts.length,1);
  await next.sync(true);assert.equal(next.snapshot().record?.conflict,true);assert.equal(next.snapshot().record?.candidate?.locator.offset,3);
  await next.chooseLocal();assert.equal(next.snapshot().record?.candidate,null);assert.equal(next.snapshot().record?.base,2);
  await next.capture(f.candidate(1));f.setCloud({...next.snapshot().record!.cloud!,revision:3,locator:{algorithm:1,paragraph:0,offset:8}});await next.refresh();assert.equal(next.snapshot().record?.conflict,true);
  const count=f.posts.length;await next.sync();assert.equal(f.posts.length,count);const cloud=await next.chooseCloud();assert.equal(cloud?.position?.locator.offset,8);assert.equal(next.snapshot().record?.candidate,null);
 }finally{f.close()}
});
test("N3 transaction and key failures cannot send, unknown late responses stay bound to the old account",async()=>{
 const f=await readingFixture();try{
  const m=f.model();await m.restore();f.db.failBeforeCommit=true;await assert.rejects(m.capture(f.candidate(4)));assert.equal(f.posts.length,0);assert.equal(m.snapshot().record?.candidate,null);
  f.db.failAfterCommit=true;await assert.rejects(m.capture(f.candidate(4)));const next=f.model();await next.restore();assert.equal(next.snapshot().record?.candidate?.locator.offset,4);
  f.setAfterPost(async()=>{f.setCurrent(false)});await next.sync();assert.equal(f.posts.length,1);assert.ok((await f.rows.read(f.owner,f.book))?.ciphertext);
  await assert.rejects(next.capture(f.candidate(7)));f.setCurrent(true);f.setAfterPost(null);const restored=f.model();await restored.restore();assert.equal(restored.snapshot().record?.candidate,null);assert.equal(f.posts.length,1);
 }finally{f.close()}
});
test("N3 scrolling during an in-flight save retains the new candidate; unreadable save never drops it",async()=>{
 const f=await readingFixture();try{
  const m=f.model();await m.restore();await m.capture(f.candidate(1));let release!:()=>void;const wait=new Promise<void>(r=>{release=r});let entered!:()=>void;const hit=new Promise<void>(r=>{entered=r});
  f.setAfterPost(async()=>{entered();await wait});const saving=m.sync();await hit;await m.capture(f.candidate(7));release();await saving;
  assert.equal(m.snapshot().record?.candidate?.locator.offset,7);assert.equal(f.posts[0].locator.offset,1);
  f.setAfterPost(null);f.setBlocked(true);await m.sync();assert.equal(m.snapshot().record?.blocked,true);assert.equal(m.snapshot().record?.candidate?.locator.offset,7);assert.equal(m.snapshot().record?.pending,null);
 }finally{f.close()}
});


test("N3 a lost acknowledgement after SQLite commit can reload locally without a second HTTP write",async()=>{
 const f=await readingFixture();try{
  const m=f.model();await m.restore();await m.capture(f.candidate(2));
  f.setAfterPost(async()=>{f.db.failAfterCommit=true});await m.sync();assert.ok(m.snapshot().record?.pending);assert.equal(f.posts.length,1);
  f.setAfterPost(null);await m.restore(true);assert.equal(m.snapshot().record?.pending,null);assert.equal(m.snapshot().record?.candidate,null);assert.equal(m.snapshot().record?.base,1);assert.equal(f.posts.length,1);
 }finally{f.close()}
});


test("N3 automatic CAS rejection refreshes conflict facts instead of displaying an obsolete cloud location",async()=>{
 const f=await readingFixture();try{
  const m=f.model();await m.restore();await m.capture(f.candidate(2));
  f.setCloud({novel_id:f.book,chapter_id:f.chapter,version:1,locator:{algorithm:1,paragraph:0,offset:8},revision:1,saved_at:"2026-11-05T00:00:00Z"});
  await m.sync();assert.equal(m.snapshot().record?.conflict,true);assert.equal(m.snapshot().record?.candidate?.locator.offset,2);assert.equal(m.snapshot().cloud?.position?.locator.offset,8);assert.equal(m.snapshot().record?.pending,null);
 }finally{f.close()}
});


import { Session as ReadingTestSession } from "../src/auth/session.ts";
import { createDraftSessionVault as readingTestVault } from "../src/drafts/access.ts";
test("N3 read-only cached identity permits own offline metadata without granting private draft access",async()=>{
 let raw:string|null=null,network=true,which=0;
 const accounts=[{id:randomUUID(),nickname:"reader A"},{id:randomUUID(),nickname:"reader B"}],tokens=['tako_app_'+"a".repeat(64),'tako_app_'+"b".repeat(64)];
 const vault=readingTestVault({get:async()=>raw,set:async v=>{raw=v},remove:async()=>{raw=null}});
 const transport=(async(path:string)=>{if(!network)throw new ApiError("network");if(path==='/me')return accounts[which];if(path==='/app/auth/logout')return;return {account:accounts[which],access_token:tokens[which],token_type:'Bearer',expires_in:604800}}) as import("../src/auth/session.ts").Transport;
 const login=new ReadingTestSession(vault,transport);await login.signIn('login','reader@example.test','not-a-real-password');assert.equal(login.snapshot().drafts.phase,'confirmation');
 network=false;const restored=new ReadingTestSession(vault,transport);await restored.restore();assert.equal(restored.snapshot().localOwner,accounts[0].id);assert.equal(restored.snapshot().drafts.phase,'locked');assert.equal(restored.snapshot().account,null);
 await vault.set(tokens[1]);const mismatched=new ReadingTestSession(vault,transport);await mismatched.restore();assert.equal(mismatched.snapshot().localOwner,null);
 network=true;which=1;const b=new ReadingTestSession(vault,transport);await b.signIn('login','other@example.test','not-a-real-password');network=false;const offlineB=new ReadingTestSession(vault,transport);await offlineB.restore();assert.equal(offlineB.snapshot().localOwner,accounts[1].id);assert.equal(offlineB.snapshot().drafts.owner,null);
});
test("N3 logout/401 lock metadata identity, while legacy draft grants retain their separate compatibility",async()=>{
 let raw:string|null=null,network=true,deny=false,removeFailure=false;
 const owner=randomUUID(),token='tako_app_'+"c".repeat(64),account={id:owner,nickname:'reader'};
 const vault=readingTestVault({get:async()=>raw,set:async v=>{raw=v},remove:async()=>{if(removeFailure)throw Error('synthetic storage');raw=null}});
 const transport=(async(path:string)=>{if(!network)throw new ApiError('network');if(deny)throw new ApiError('authentication_required','',401);if(path==='/me')return account;if(path==='/app/auth/logout')return;return {account,access_token:token,token_type:'Bearer',expires_in:604800}}) as import("../src/auth/session.ts").Transport;
 const a=new ReadingTestSession(vault,transport);await a.signIn('login','reader@example.test','not-a-real-password');network=false;await assert.rejects(a.logout());const locked=new ReadingTestSession(vault,transport);await locked.restore();assert.equal(locked.snapshot().localOwner,null);
 // Old envelope has no new identity field. Its confirmed draft authorization is preserved, not reused for reading.
 raw=JSON.stringify({format:1,token,grant:{owner,confirmed:true}});const legacy=new ReadingTestSession(vault,transport);await legacy.restore();assert.equal(legacy.snapshot().drafts.phase,'offline');assert.equal(legacy.snapshot().localOwner,null);
 network=true;await legacy.restore();assert.equal(legacy.snapshot().localOwner,owner);removeFailure=true;await assert.rejects(legacy.logout());network=false;const failedRemoval=new ReadingTestSession(vault,transport);await failedRemoval.restore();assert.equal(failedRemoval.snapshot().localOwner,null);
 removeFailure=false;network=true;deny=true;await failedRemoval.restore();assert.equal(failedRemoval.snapshot().phase,'guest');assert.equal(failedRemoval.snapshot().localOwner,null);
 raw=JSON.stringify({format:1,token,grant:{owner,confirmed:false},local_owner:randomUUID()});network=false;const corrupt=new ReadingTestSession(vault,transport);await corrupt.restore();assert.equal(corrupt.snapshot().localOwner,null);assert.equal(corrupt.snapshot().drafts.phase,'locked');
});

import {
  NovelLifecycleApi,
  checkedLifecycleReceipt,
  checkedCompletionCheck,
  checkedRectification,
  checkedRectificationPreview,
  type LifecycleReceipt,
  type CompletionCheck,
  type Rectification,
  type RectificationPreview,
} from "../src/novels/lifecycle-api.ts";

test("completion decode binds book/check and rejects contradictory irreversible eligibility", () => {
  const book = randomUUID(),
    check = randomUUID(),
    chapter = randomUUID();
  const value: CompletionCheck = {
    id: check,
    novel_id: book,
    state_revision: 1,
    formal_chapters: 1,
    last_formal_chapter: chapter,
    last_formal_ordinal: 2,
    last_reserved_ordinal: 3,
    hidden_chapters: 0,
    restricted_chapters: 1,
    pending_chapters: 0,
    unpublished_drafts: 2,
    author_hidden: true,
    platform_limited: true,
    completed: false,
    eligible: true,
    expires_at: new Date().toISOString(),
  };
  assert.equal(checkedCompletionCheck(value, book, check), value);
  for (const bad of [
    { ...value, novel_id: randomUUID() },
    { ...value, id: randomUUID() },
    { ...value, pending_chapters: 1 },
    { ...value, completed: true },
    { ...value, formal_chapters: 0 },
    { ...value, hidden_chapters: 2 },
    { ...value, last_reserved_ordinal: 1 },
    { ...value, state_revision: 0 },
  ])
    assert.throws(() => checkedCompletionCheck(bad, book, check), ApiError);
});
test("lifecycle original receipts bind operation, mutation, target and result version", () => {
  const book = randomUUID(),
    mutation = randomUUID(),
    target = randomUUID();
  const receipt: LifecycleReceipt = {
    mutation_id: mutation,
    operation: "rectification_approve",
    novel_id: book,
    target_id: target,
    state: "approved",
    revision: 3,
    version: 2,
    accepted_at: new Date().toISOString(),
  };
  assert.equal(
    checkedLifecycleReceipt(
      receipt,
      book,
      mutation,
      "rectification_approve",
      target,
    ),
    receipt,
  );
  for (const bad of [
    { ...receipt, mutation_id: randomUUID() },
    { ...receipt, novel_id: randomUUID() },
    { ...receipt, target_id: randomUUID() },
    { ...receipt, state: "submitted" },
    { ...receipt, version: 0 },
    { ...receipt, operation: "complete" },
  ])
    assert.throws(
      () =>
        checkedLifecycleReceipt(
          bad as LifecycleReceipt,
          book,
          mutation,
          "rectification_approve",
          target,
        ),
      ApiError,
    );
});
test("rectification fixed evidence binds grant/chapter/base and keeps cancelled unsubmitted history valid", () => {
  const book = randomUUID(),
    grantId = randomUUID(),
    chapter = randomUUID(),
    preview = randomUUID();
  const now = new Date().toISOString();
  const grant: Rectification = {
    id: grantId,
    novel_id: book,
    chapter_id: chapter,
    case_id: 1,
    case_revision: 1,
    base_version: 2,
    revision: 2,
    state: "submitted",
    reason: "指定整改",
    decision_reason: "",
    preview_id: preview,
    created_at: now,
    submitted_at: now,
    decided_at: null,
    published_version: 0,
    revoked_case: false,
    target_current: true,
  };
  const fixed: RectificationPreview = {
    id: preview,
    grant_id: grantId,
    novel_id: book,
    chapter_id: chapter,
    base_version: 2,
    grant_revision: 1,
    draft_id: randomUUID(),
    source_revision: 4,
    title: "指定章",
    content: "固定正文",
    expires_at: now,
  };
  assert.equal(checkedRectification(grant, book, grantId), grant);
  assert.equal(checkedRectificationPreview(fixed, book, preview, grant), fixed);
  for (const bad of [
    { ...fixed, grant_id: randomUUID() },
    { ...fixed, chapter_id: randomUUID() },
    { ...fixed, base_version: 3 },
    { ...fixed, grant_revision: 2 },
  ])
    assert.throws(
      () => checkedRectificationPreview(bad, book, preview, grant),
      ApiError,
    );
  for (const bad of [
    { ...grant, preview_id: null },
    { ...grant, revoked_case: true },
    { ...grant, published_version: 1 },
    { ...grant, decided_at: now },
  ])
    assert.throws(() => checkedRectification(bad, book, grantId), ApiError);
  checkedRectification(
    {
      ...grant,
      state: "cancelled",
      revision: 2,
      submitted_at: null,
      preview_id: null,
      decided_at: now,
      decision_reason: "取消未提交授权",
    },
    book,
    grantId,
  );
});
test("lifecycle client refuses unsafe confirmation before transport, validates original GETs without POST", async () => {
  const book = randomUUID(),
    mutation = randomUUID(),
    target = randomUUID();
  let calls = 0;
  const api = new NovelLifecycleApi(
    async <T>(path: string, options?: { method?: string }) => {
      calls++;
      assert.equal(options?.method, undefined);
      assert.equal(path, `/my/novels/${book}/lifecycle-requests/${mutation}`);
      return {
        mutation_id: mutation,
        operation: "completion_check",
        novel_id: book,
        target_id: target,
        state: "prepared",
        revision: 1,
        version: 0,
        accepted_at: new Date().toISOString(),
      } as T;
    },
  );
  assert.throws(
    () =>
      api.complete(book, {
        mutation_id: mutation,
        check_id: target,
        irreversible_confirmed: false as true,
      }),
    ApiError,
  );
  assert.equal(calls, 0);
  await api.receipt(book, mutation, "completion_check");
  assert.equal(calls, 1);
  await assert.rejects(
    () => api.receipt(book, mutation, "complete", target),
    ApiError,
  );
});
