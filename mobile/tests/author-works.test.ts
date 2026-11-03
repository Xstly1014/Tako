import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AuthorWorksApi,
  WorkAction,
  checkedWorkState,
  type WorkState,
} from "../src/api/author-works.ts";
import type { Transport } from "../src/auth/session.ts";
import { ApiError } from "../src/api/client.ts";
import {
  readVersionPair,
  versionDecisionBlock,
} from "../src/author-works/version-decision.ts";
import {
  AuthorAppealsApi,
  type CaseDetail,
  type CasePage,
} from "../src/api/author-appeals.ts";
import { AuthorAppeals } from "../src/author-works/appeals.ts";

const caseDetail = (): CaseDetail => ({
  case: {
    id: 50,
    work_id: id,
    version: 1,
    scope: "version",
    reason: "固定版本需检查",
    state: "active",
    revision: 1,
    created_at: "2026-10-01T00:00:00Z",
    next_appeal_at: null,
  },
  appeals: { items: [], next: 0 },
  work: {
    id,
    version: 1,
    title: "受限正式标题",
    content: "固定正式正文",
    introduction: "",
    tags: ["日常"],
    author_nickname: "合成作者",
    published_at: "2026-10-01T00:00:00Z",
  },
  revocation: null,
});
test("再次复核不能沿用上次成功提示；明确拒绝后保留本次理由等待重读", async () => {
  let posts = 0;
  const flow = new AuthorAppeals(
    appealsApi(async (_path, options) => {
      if (options?.method === "POST") {
        if (++posts === 2) throw new ApiError("appeal_cooldown", "", 409);
        return { id: 71, state: "pending", revision: 1 };
      }
      const detail = caseDetail();
      if (posts) detail.case.revision = 2;
      return detail;
    }),
    () => true,
    randomUUID,
  );
  await flow.open(50);
  flow.prepare("第一次申请");
  await flow.send();
  assert.equal(flow.snapshot().confirmed, true);
  flow.prepare("第二次新理由");
  assert.equal(flow.snapshot().confirmed, false);
  await flow.send();
  assert.equal(flow.snapshot().confirmed, false);
  assert.equal(flow.snapshot().needsRead, true);
  assert.equal(flow.snapshot().pending, null);
});
test("处置列表翻页与失焦恢复：旧请求取消，旧结果不能覆盖新读取", async () => {
  const rows = Array.from({ length: 20 }, (_, n) => ({
    ...caseDetail().case,
    id: 60 - n,
  }));
  const pages = appealsApi(async (path) =>
    path.includes("before=41")
      ? { items: [{ ...caseDetail().case, id: 40 }], next: 0 }
      : { items: rows, next: 41 },
  );
  const flow = new AuthorAppeals(pages, () => true, randomUUID);
  await flow.read();
  await flow.read(true);
  assert.equal(flow.snapshot().page.items.length, 21);
  const pending: { resolve: (page: CasePage) => void; signal?: AbortSignal }[] =
    [];
  const resumed = new AuthorAppeals(
    appealsApi(
      async (_path, opts) =>
        new Promise((resolve) =>
          pending.push({
            resolve: resolve as (page: CasePage) => void,
            signal: opts?.signal,
          }),
        ),
    ),
    () => true,
    randomUUID,
  );
  const old = resumed.read();
  resumed.suspend();
  const fresh = resumed.read();
  assert.equal(pending[0].signal?.aborted, true);
  pending[1].resolve({ items: rows, next: 41 });
  await fresh;
  pending[0].resolve({ items: [], next: 0 });
  await old;
  assert.equal(resumed.snapshot().page.items.length, 20);
  assert.equal(resumed.snapshot().busy, false);
});
const appealsApi = (
  fn: (path: string, options?: Parameters<Transport>[1]) => Promise<unknown>,
) => new AuthorAppealsApi(fn as Transport);
test("处置API校验固定版本/历史归属/降序游标，不把跨账号或坏成功回执作成功", async () => {
  let detail = caseDetail();
  const client = appealsApi(async () => detail);
  assert.equal((await client.detail(50)).work.version, 1);
  detail.work.version = 2;
  await assert.rejects(client.detail(50), { code: "contract" });
  detail = caseDetail();
  detail.appeals.items = [
    {
      id: 3,
      case_id: 49,
      reason: "wrong case",
      state: "pending",
      decision_reason: "",
      created_at: detail.case.created_at,
      decided_at: null,
    },
  ];
  await assert.rejects(client.detail(50), { code: "contract" });
  const reversed: CasePage = {
    items: [
      { ...caseDetail().case, id: 1 },
      { ...caseDetail().case, id: 2 },
    ],
    next: 0,
  };
  await assert.rejects(appealsApi(async () => reversed).list(), {
    code: "contract",
  });
  const input = {
    mutation_id: randomUUID(),
    expected_revision: 1,
    decision: "appeal" as const,
    reason: "重新核对",
  };
  await assert.rejects(
    appealsApi(async () => ({ id: 7, state: "active", revision: 1 })).appeal(
      50,
      input,
    ),
    { code: "contract" },
  );
  await assert.rejects(
    appealsApi(async () => ({ id: 7, state: "pending", revision: 2 })).appeal(
      50,
      input,
    ),
    { code: "contract" },
  );
});
test("复核未知结果固定原请求；成功后读失败仍确认，只读重试不重复POST", async () => {
  const writes: unknown[] = [];
  let mode = "ready";
  const client = appealsApi(async (_path, options) => {
    if (options?.method === "POST") {
      writes.push(structuredClone(options.body));
      if (writes.length < 3)
        throw new ApiError(
          writes.length === 1 ? "network" : "rate_limited",
          "",
          writes.length === 1 ? 0 : 429,
        );
      mode = "read-failed";
      return { id: 701, state: "pending", revision: 1 };
    }
    if (mode === "read-failed")
      throw new ApiError("service_unavailable", "", 503);
    const detail = caseDetail();
    if (writes.length)
      detail.appeals.items = [
        {
          id: 701,
          case_id: 50,
          reason: "具体位置",
          state: "pending",
          decision_reason: "",
          created_at: detail.case.created_at,
          decided_at: null,
        },
      ];
    return detail;
  });
  const flow = new AuthorAppeals(client, () => true, randomUUID);
  await flow.open(50);
  flow.prepare("具体位置");
  await flow.send();
  const original = flow.snapshot().pending;
  assert.ok(original);
  assert.throws(() => flow.prepare("另一个理由"));
  await assert.rejects(flow.open(51));
  await flow.send();
  assert.equal(flow.snapshot().pending, original);
  await flow.send();
  assert.equal(flow.snapshot().pending, null);
  assert.equal(flow.snapshot().confirmed, true);
  assert.equal(flow.snapshot().needsRead, true);
  assert.throws(() => flow.prepare("新理由"));
  assert.deepEqual(writes[0], writes[1]);
  assert.deepEqual(writes[1], writes[2]);
  mode = "ready";
  await flow.read();
  assert.equal(flow.snapshot().detail?.case.id, 50);
  assert.equal(writes.length, 3);
  assert.equal(flow.snapshot().needsRead, false);
  assert.throws(() => flow.prepare("已有处理中"));
});
test("复核并发点击拦截；明确409释放原请求并强制刷新；手机时间不裁定冷静期", async () => {
  let release!: () => void,
    posts = 0;
  const detail = caseDetail();
  detail.case.next_appeal_at = "2099-01-01T00:00:00Z";
  const flow = new AuthorAppeals(
    appealsApi(async (_path, options) => {
      if (options?.method !== "POST") return structuredClone(detail);
      posts++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      throw new ApiError("appeal_cooldown", "", 409);
    }),
    () => true,
    randomUUID,
  );
  await flow.open(50);
  flow.prepare("由服务端校验冷静期");
  const first = flow.send();
  await assert.rejects(flow.send());
  release();
  await first;
  assert.equal(posts, 1);
  assert.equal(flow.snapshot().pending, null);
  assert.equal(flow.snapshot().needsRead, true);
  assert.throws(() => flow.prepare("新理由"));
  detail.case.state = "revoked";
  detail.revocation = {
    reason: "纠正误判",
    created_at: detail.case.created_at,
  };
  await flow.read();
  assert.throws(() => flow.prepare("撤销后不可申请"));
});
test("处置和复核各自分页，失败保留同游标，切号/离开阻断迟到私密详情", async () => {
  let fail = true,
    valid = true;
  const cursors: string[] = [];
  const detail = caseDetail();
  detail.appeals.items = Array.from({ length: 20 }, (_, n) => ({
    id: 30 - n,
    case_id: 50,
    reason: "历史理由",
    state: "upheld" as const,
    decision_reason: "历史结论",
    created_at: detail.case.created_at,
    decided_at: detail.case.created_at,
  }));
  detail.appeals.next = 11;
  const flow = new AuthorAppeals(
    appealsApi(async (path) => {
      cursors.push(path);
      if (path.includes("before=11")) {
        if (fail) {
          fail = false;
          throw new ApiError("network");
        }
        return {
          ...detail,
          appeals: { items: [{ ...detail.appeals.items[0], id: 10 }], next: 0 },
        };
      }
      return structuredClone(detail);
    }),
    () => valid,
    randomUUID,
  );
  await flow.open(50);
  await flow.read(true);
  assert.equal(flow.snapshot().detail?.appeals.items.length, 20);
  assert.equal(flow.snapshot().detail?.appeals.next, 11);
  await flow.read(true);
  assert.equal(flow.snapshot().detail?.appeals.items.length, 21);
  assert.equal(cursors.at(-1), cursors.at(-2));
  let release!: (value: CaseDetail) => void;
  const stale = new AuthorAppeals(
    appealsApi(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ),
    () => valid,
    randomUUID,
  );
  const read = stale.open(50);
  valid = false;
  stale.dispose();
  release(caseDetail());
  await read;
  assert.equal(stale.snapshot().detail, null);
});
test("复核理由按Unicode码点校验，坏回执5xx均保留，重新进入不自动补发", async () => {
  const posted: unknown[] = [];
  const flow = new AuthorAppeals(
    appealsApi(async (_path, options) => {
      if (options?.method !== "POST") return caseDetail();
      posted.push(options.body);
      return { id: 1, state: "pending", revision: 99 };
    }),
    () => true,
    randomUUID,
  );
  await flow.open(50);
  assert.throws(() => flow.prepare(" "));
  assert.throws(() => flow.prepare("😀".repeat(2001)));
  assert.throws(() => flow.prepare("\ud800"));
  flow.prepare("😀".repeat(2000));
  await flow.send();
  assert.ok(flow.snapshot().pending);
  flow.dispose();
  await flow.open(50);
  assert.equal(posted.length, 1);
  assert.equal(flow.snapshot().pending, null);
});
import {
  AuthorCatalog,
  emptyCatalogQuery,
  normalizeCatalogQuery,
} from "../src/author-works/catalog.ts";
import type { CatalogPage } from "../src/api/author-works.ts";

test("目录API显式提交条件、取消信号与新摘要校验，旧调用不受影响", async () => {
  const controller = new AbortController();
  let path = "";
  const client = api(async (p, options) => {
    path = p;
    assert.equal(options?.signal, controller.signal);
    return { items: [], next_cursor: "opaque_next" };
  });
  await client.catalog(
    { q: "  A%_\\  ", visibility: "hidden", restriction: "restricted" },
    "",
    controller.signal,
  );
  const params = new URL("http://local" + path).searchParams;
  assert.equal(params.get("q"), "a%_\\");
  assert.equal(params.get("visibility"), "hidden");
  assert.throws(() =>
    normalizeCatalogQuery({ ...emptyCatalogQuery(), q: "😀".repeat(65) }),
  );
  assert.throws(() =>
    normalizeCatalogQuery({ ...emptyCatalogQuery(), q: "bad\n" }),
  );
  assert.equal(
    normalizeCatalogQuery({ ...emptyCatalogQuery(), q: "😀".repeat(64) }).q
      .length,
    128,
  );
  const malformed = api(async () => ({
    items: [{ ...state(), title: "title" }],
    next_cursor: "",
  }));
  await assert.rejects(malformed.catalog(emptyCatalogQuery()), {
    code: "contract",
  });
  await malformed.list();
});

test("全量目录换条件取消迟到响应；分页失败保留游标、去重并拦截循环", async () => {
  const pending: {
    resolve: (page: CatalogPage) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    cursor?: string;
  }[] = [];
  const catalog = new AuthorCatalog(
    {
      catalog: async (_q, cursor, signal) =>
        new Promise((resolve, reject) =>
          pending.push({ resolve, reject, signal, cursor }),
        ),
    },
    () => true,
  );
  const item = {
    ...state(),
    title: "title",
    latest_title: "latest",
    display_limited: false,
  };
  const old = catalog.apply(emptyCatalogQuery());
  const fresh = catalog.apply({ ...emptyCatalogQuery(), q: "new" });
  assert.equal(pending[0].signal?.aborted, true);
  pending[1].resolve({ items: [item], next_cursor: "page2" });
  await fresh;
  pending[0].resolve({ items: [], next_cursor: "" });
  await old;
  assert.equal(catalog.snapshot().page.items.length, 1);
  const failed = catalog.more();
  pending[2].reject(new ApiError("network"));
  await failed;
  assert.equal(catalog.snapshot().page.next_cursor, "page2");
  const retry = catalog.more();
  assert.equal(pending[3].cursor, "page2");
  pending[3].resolve({
    items: [item, { ...item, id: randomUUID() }],
    next_cursor: "page3",
  });
  await retry;
  assert.equal(catalog.snapshot().page.items.length, 2);
  const loop = catalog.more();
  pending[4].resolve({ items: [], next_cursor: "page2" });
  await loop;
  assert.equal((catalog.snapshot().error as ApiError).code, "contract");
  assert.equal(catalog.snapshot().page.next_cursor, "page3");
});

test("管理返回保留条件刷新首屏，切号或退出的迟到私密列表不可写入", async () => {
  let valid = true,
    release!: (page: CatalogPage) => void;
  const calls: string[] = [];
  const catalog = new AuthorCatalog(
    {
      catalog: async (q, cursor) => {
        calls.push(q.visibility + ":" + cursor);
        return { items: [], next_cursor: "" };
      },
    },
    () => valid,
  );
  await catalog.apply({ ...emptyCatalogQuery(), visibility: "hidden" });
  await catalog.refresh();
  assert.deepEqual(calls, ["hidden:", "hidden:"]);
  assert.equal(catalog.snapshot().refreshed, true);
  const stale = new AuthorCatalog(
    {
      catalog: async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    () => valid,
  );
  const request = stale.refresh();
  valid = false;
  stale.cancel();
  release({
    items: [
      {
        ...state(),
        title: "private",
        latest_title: "private",
        display_limited: false,
      },
    ],
    next_cursor: "",
  });
  await request;
  assert.equal(stale.snapshot().page.items.length, 0);
});
const id = randomUUID(),
  draft = randomUUID();
const state = (): WorkState => ({
  id,
  draft_id: draft,
  last_version: 2,
  display_version: 2,
  author_hidden: false,
  history_open: false,
  platform_limited: false,
  state_revision: 1,
});
const formal = (version: number, content = "固定全文😀\n结尾") => ({
  id,
  version,
  title: "正式标题",
  content,
  introduction: "正式简介",
  tags: ["日常", "幻想"],
  author_nickname: "作者",
  published_at: "2026-10-01T00:00:00Z",
});
const timeline = (current = state()) => ({
  state: current,
  versions: [],
  events: [],
  next_version_before: 0,
  next_event_before: 0,
});
test("版本核对用展示指针并读取两份全文，字段精确比较，候选可以来自20条之后", async () => {
  const snapshot = { ...state(), last_version: 30, display_version: 29 };
  const calls: string[] = [];
  const client = api(async (path) => {
    calls.push(path);
    if (path.includes("?")) return timeline(snapshot);
    return path.endsWith("/29")
      ? formal(29)
      : { ...formal(1, "固定全文😀\n结尾 "), tags: ["幻想", "日常"] };
  });
  const result = await readVersionPair(
    client,
    snapshot,
    1,
    new AbortController().signal,
  );
  assert.equal(result.current.version, 29);
  assert.equal(result.candidate.version, 1);
  assert.equal(result.current.content, "固定全文😀\n结尾");
  assert.equal(result.candidate.content, "固定全文😀\n结尾 ");
  assert.deepEqual(result.changed, {
    title: false,
    introduction: false,
    tags: false,
    content: true,
  });
  assert.ok(calls[0].endsWith("/29"));
  assert.ok(calls[1].endsWith("/1"));
  assert.ok(calls[2].includes("/versions?"));
});
test("版本核对期间状态变化、坏版本身份或提前取消不能得到可决策结果", async () => {
  for (const patch of [
    { state_revision: 2 },
    { display_version: 1 },
    { author_hidden: true },
    { last_version: 3 },
  ]) {
    const client = api(async (path) =>
      path.includes("?")
        ? timeline({ ...state(), ...patch })
        : formal(path.endsWith("/1") ? 1 : 2),
    );
    await assert.rejects(
      readVersionPair(client, state(), 1, new AbortController().signal),
      { code: "comparison_state_changed" },
    );
  }
  const wrong = api(async (path) =>
    path.includes("?") ? timeline() : { ...formal(1), id: randomUUID() },
  );
  await assert.rejects(
    readVersionPair(wrong, state(), 1, new AbortController().signal),
    { code: "contract" },
  );
  const aborted = new AbortController();
  aborted.abort();
  let calls = 0;
  await assert.rejects(
    readVersionPair(
      api(async () => {
        calls++;
        return formal(1);
      }),
      state(),
      1,
      aborted.signal,
    ),
    { code: "comparison_cancelled" },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    readVersionPair(wrong, state(), 2, new AbortController().signal),
    { code: "invalid_input" },
  );
});
test("版本读取失败取消同行请求，完成前取消不会返回全文或继续状态读取", async () => {
  let sibling: AbortSignal | undefined;
  const failing = api(async (path, options) => {
    if (path.endsWith("/1")) throw new ApiError("network");
    sibling = options?.signal;
    return formal(2);
  });
  await assert.rejects(
    readVersionPair(failing, state(), 1, new AbortController().signal),
  );
  assert.equal(sibling?.aborted, true);
  const releases: (() => void)[] = [],
    cancel = new AbortController();
  let reads = 0;
  const slow = api(async (path) => {
    reads++;
    await new Promise<void>((resolve) => releases.push(resolve));
    return formal(path.endsWith("/1") ? 1 : 2);
  });
  const request = readVersionPair(slow, state(), 1, cancel.signal);
  cancel.abort();
  releases.forEach((fn) => fn());
  await assert.rejects(request, { code: "comparison_cancelled" });
  assert.equal(reads, 2);
});
const api = (
  fn: (path: string, options?: Parameters<Transport>[1]) => Promise<unknown>,
) => new AuthorWorksApi(fn as Transport);
test("成功HTTP的管理回执必须反映原动作与合法修订，矛盾回执保留待确认请求", async () => {
  for (const example of [
    { action: "hide", patch: { author_hidden: false } },
    { action: "switch_display", version: 1, patch: { display_version: 2 } },
    {
      action: "restore",
      version: 1,
      patch: { author_hidden: true, display_version: 1 },
    },
    { action: "restore", patch: { display_version: 1 } },
    { action: "set_history", history: true, patch: { history_open: false } },
    { action: "hide", patch: { state_revision: 0 } },
    { action: "hide", patch: { state_revision: 4 } },
  ] as const) {
    const op = new WorkAction(id, () => true, randomUUID);
    const body = op.prepare(
      { ...state(), author_hidden: example.action === "restore" },
      example.action,
      "version" in example ? example.version : undefined,
      "history" in example ? example.history : undefined,
    );
    const malformed = api(async () => ({
      ...state(),
      author_hidden: example.action === "hide",
      history_open: true,
      state_revision: 2,
      ...example.patch,
    }));
    await assert.rejects(
      op.send(body, malformed),
      (error: unknown) =>
        error instanceof ApiError && error.code === "contract",
    );
    assert.equal(op.pending, body);
  }
});
test("管理无变化回执和晚重放仍有效，回执不能替代重新读取当前状态", async () => {
  const op = new WorkAction(id, () => true, randomUUID);
  const snapshot = { ...state(), author_hidden: true };
  const noChange = op.prepare(snapshot, "hide");
  const receipt = await op.send(
    noChange,
    api(async () => snapshot),
  );
  assert.equal(receipt.state_revision, 1);
  assert.equal(op.pending, null);
  const old = { ...state(), state_revision: 2, author_hidden: true };
  assert.equal(
    (
      await api(async () => old).change(id, {
        mutation_id: randomUUID(),
        expected_state_revision: 1,
        action: "hide",
      })
    ).state_revision,
    2,
  );
});
test("隐藏作品恢复遵守既有资格：新版正常须恢复新版，只有新版受限才允许正常旧版", () => {
  const versions = [2, 1].map((version) => ({
    version,
    title: "正式版",
    published_at: "2026-10-01T00:00:00Z",
    platform_limited: false,
    review_status: "pending",
  }));
  const hidden = { ...state(), author_hidden: true };
  assert.equal(
    versionDecisionBlock(hidden, 1, versions),
    "restore_latest_required",
  );
  assert.equal(versionDecisionBlock(hidden, 2, versions), "");
  versions[0].platform_limited = true;
  assert.equal(versionDecisionBlock(hidden, 1, versions), "");
  assert.equal(versionDecisionBlock(hidden, 2, versions), "unavailable");
  assert.equal(
    versionDecisionBlock({ ...hidden, platform_limited: true }, 1, versions),
    "unavailable",
  );
  assert.equal(versionDecisionBlock(hidden, 1, [versions[1]]), "unavailable");
});
test("管理操作丢响应只重发同一请求，不能插入第二个操作；回执不作现状", async () => {
  const op = new WorkAction(id, () => true, randomUUID),
    calls: unknown[] = [];
  const client = api(async (_path, opts) => {
    calls.push(structuredClone(opts?.body));
    if (calls.length === 1) throw new ApiError("network");
    return { ...state(), state_revision: 2, author_hidden: true };
  });
  const body = op.prepare(state(), "hide");
  await assert.rejects(op.send(body, client));
  assert.equal(op.pending, body);
  assert.throws(() => op.prepare(state(), "set_history", undefined, true));
  await assert.rejects(op.send({ ...body, mutation_id: randomUUID() }, client));
  await op.send(body, client);
  assert.equal(op.pending, null);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls.length, 2);
});
test("并发点击被拒绝，明确冲突释放原请求，未知结果保留", async () => {
  const op = new WorkAction(id, () => true, randomUUID);
  let release!: () => void;
  const waiting = api(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw new ApiError("work_state_conflict", "", 409);
  });
  const body = op.prepare(state(), "hide"),
    first = op.send(body, waiting);
  await assert.rejects(op.send(body, waiting));
  release();
  await assert.rejects(first);
  assert.equal(op.pending, null);
  const next = op.prepare(state(), "set_history", undefined, true);
  await assert.rejects(
    op.send(
      next,
      api(async () => {
        throw new ApiError("service_unavailable", "", 503);
      }),
    ),
  );
  assert.equal(op.pending, next);
});
test("切号或销毁后不能提交，迟到回执不能确认旧账号操作", async () => {
  let current = true,
    calls = 0,
    release!: () => void;
  const op = new WorkAction(id, () => current, randomUUID),
    body = op.prepare(state(), "hide");
  const pending = op.send(
    body,
    api(async () => {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ...state(), author_hidden: true, state_revision: 2 };
    }),
  );
  current = false;
  release();
  await assert.rejects(
    pending,
    (e: unknown) => e instanceof ApiError && e.code === "stale_session",
  );
  await assert.rejects(
    op.send(
      body,
      api(async () => {
        calls++;
        return state();
      }),
    ),
  );
  op.dispose();
  current = true;
  assert.throws(() => op.prepare(state(), "hide"));
  assert.equal(calls, 1);
});
test("只构造与动作相符的字段，作品限制阻止恢复或切版，恢复默认不回退", () => {
  const op = new WorkAction(id, () => true, randomUUID);
  assert.equal(op.prepare(state(), "restore").version, undefined);
  assert.equal(op.prepare(state(), "restore", 1).version, 1);
  assert.equal(
    op.prepare(state(), "set_history", undefined, true).history_open,
    true,
  );
  assert.equal(op.prepare(state(), "hide", 1, true).version, undefined);
  assert.throws(() => op.prepare(state(), "switch_display", 3));
  assert.throws(() =>
    op.prepare({ ...state(), platform_limited: true }, "restore"),
  );
  assert.throws(() => op.prepare({ ...state(), id: randomUUID() }, "hide"));
});
test("API 拒绝错误归属、重复分页、畸形正文；本人版本走私有接口", async () => {
  assert.throws(() => checkedWorkState({ ...state(), display_version: 3 }));
  const client = api(async () => ({ items: [], next_cursor: id }));
  await assert.rejects(client.list(id));
  const timeline = {
    state: { ...state(), id: randomUUID() },
    versions: [],
    events: [],
    next_version_before: 0,
    next_event_before: 0,
  };
  await assert.rejects(api(async () => timeline).timeline(id));
  const paths: string[] = [];
  await assert.rejects(
    api(async (path) => {
      paths.push(path);
      return { id, version: 1 };
    }).version(id, 1),
  );
  assert.deepEqual(paths, [`/my/works/${id}/versions/1`]);
});
