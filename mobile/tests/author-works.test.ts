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
const api = (
  fn: (path: string, options?: Parameters<Transport>[1]) => Promise<unknown>,
) => new AuthorWorksApi(fn as Transport);
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
      return state();
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
