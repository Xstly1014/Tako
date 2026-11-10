import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "../src/api/client.ts";
import {
  NovelShelfApi,
  checkedShelfState,
  checkedShelfReceipt,
  type ShelfReceipt,
  type ShelfState,
  type ShelfWrite,
  type ShelfPage,
} from "../src/novels/shelf-api.ts";
const book = randomUUID(),
  time = "2026-11-05T00:00:00Z";
const input: ShelfWrite = {
  mutation_id: randomUUID(),
  base_revision: 0,
  operation: "join",
};
const state: ShelfState = {
  novel_id: book,
  in_shelf: true,
  following: true,
  revision: 1,
  generation: 1,
  added_at: time,
  updated_at: time,
};
const receipt: ShelfReceipt = {
  mutation_id: input.mutation_id,
  operation: "join",
  state,
  accepted_at: time,
};
test("书架原回执绑定作品操作修订，客户端不自动重发POST", async () => {
  const calls: { method?: string; path: string }[] = [];
  const api = new NovelShelfApi(
    async <T>(path: string, o?: { method?: string }) => {
      calls.push({ path, method: o?.method });
      return receipt as T;
    },
  );
  assert.equal((await api.write(book, input)).state.generation, 1);
  await api.receipt(book, input);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["POST", undefined],
  );
  assert.match(calls[1].path, /requests/);
  for (const bad of [
    { ...receipt, mutation_id: randomUUID() },
    { ...receipt, operation: "remove" },
    { ...receipt, state: { ...state, novel_id: randomUUID() } },
    { ...receipt, state: { ...state, revision: 2 } },
    { ...receipt, state: { ...state, following: false } },
    { ...receipt, content: "私稿不允许进入回执" },
  ])
    assert.throws(
      () => checkedShelfReceipt(bad as ShelfReceipt, book, input),
      ApiError,
    );
  await assert.rejects(
    api.write(book, { ...input, owner_id: randomUUID() } as ShelfWrite),
    ApiError,
  );
  assert.equal(calls.length, 2);
});
test("书架空关系与墓碑区分，矛盾关系和伪造字段被拒绝", () => {
  assert.equal(
    checkedShelfState({
      ...state,
      in_shelf: false,
      following: false,
      revision: 0,
      generation: 0,
      added_at: null,
      updated_at: null,
    }).revision,
    0,
  );
  assert.equal(
    checkedShelfState({ ...state, in_shelf: false, following: false }).revision,
    1,
  );
  for (const bad of [
    { ...state, in_shelf: false },
    { ...state, generation: 2 },
    { ...state, revision: 0 },
    { ...state, added_at: null },
    { ...state, start_sequence: 99 },
    { ...state, revision: Number.MAX_SAFE_INTEGER + 1 },
  ])
    assert.throws(() => checkedShelfState(bad as ShelfState), ApiError);
});
test("书架不可读占位不泄漏标题，分页拒错书与重复条目", async () => {
  let value: ShelfPage = {
    items: [{ relation: state, book: null }],
    next_cursor: "",
  };
  const api = new NovelShelfApi(async <T>() => value as T);
  assert.equal((await api.list()).items[0].book, null);
  value = {
    items: [
      { relation: state, book: null },
      { relation: state, book: null },
    ],
    next_cursor: "",
  };
  await assert.rejects(api.list(), ApiError);
  value = {
    items: [
      { relation: { ...state, in_shelf: false, following: false }, book: null },
    ],
    next_cursor: "",
  };
  await assert.rejects(api.list(), ApiError);
  value = {
    items: [
      {
        relation: state,
        book: {
          id: randomUUID(),
          title: "合成",
          introduction: "",
          tags: ["日常"],
          author: "作者",
          completed: false,
          chapter_count: 1,
          first_published_at: time,
          latest_chapter_published_at: time,
        },
      },
    ],
    next_cursor: "",
  };
  await assert.rejects(api.list(), ApiError);
});

import { fixture } from "./helpers/drafts.ts";
import { EncryptedShelfJournal } from "../src/novels/shelf-journal.ts";
import {
  ShelfOperations,
  checkedShelfRecord,
} from "../src/novels/shelf-requests.ts";
const ack = (
  target: string,
  write: ShelfWrite,
  generation = 1,
): ShelfReceipt => {
  const now = new Date().toISOString();
  return {
    mutation_id: write.mutation_id,
    operation: write.operation,
    accepted_at: now,
    state: {
      novel_id: target,
      in_shelf: write.operation !== "remove",
      following: write.operation === "join" || write.operation === "follow",
      revision: write.base_revision + 1,
      generation,
      added_at: now,
      updated_at: now,
    },
  };
};
test("书架四类命令先加密后POST，丢响应重挂仅GET同一原结果", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const owner = randomUUID();
  let current = true,
    active: ShelfWrite;
  let generation = 0;
  const receipts = new Map<string, ShelfReceipt>(),
    methods: string[] = [];
  const journal = new EncryptedShelfJournal(
    f.rows,
    f.cipher,
    owner,
    () => current,
  );
  const api = new NovelShelfApi(
    async <T>(_p: string, o?: { method?: string; body?: unknown }) => {
      methods.push(o?.method ?? "GET");
      if (o?.method === "POST") {
        const stored = await journal.load();
        assert.equal(stored?.input.mutation_id, active.mutation_id);
        assert.equal(stored?.receipt, null);
        if (active.operation === "join" || active.operation === "follow")
          generation++;
        receipts.set(active.mutation_id, ack(book, active, generation));
        throw new ApiError("network");
      }
      return receipts.get(active.mutation_id) as T;
    },
  );
  const make = () =>
    new ShelfOperations(owner, journal, api, () => current, randomUUID);
  for (const operation of ["join", "unfollow", "follow", "remove"] as const) {
    active = {
      mutation_id: randomUUID(),
      base_revision: methods.filter((m) => m === "POST").length,
      operation,
    };
    const ops = make();
    await ops.load();
    await assert.rejects(ops.start(book, active), ApiError);
    assert.equal(ops.snapshot().record?.receipt, null);
    const remount = make();
    const before = methods.length;
    await Promise.all([remount.load(), remount.load()]);
    assert.equal(methods.length, before);
    await remount.confirm();
    assert.equal(
      remount.snapshot().record?.receipt?.mutation_id,
      active.mutation_id,
    );
    await remount.clear();
    assert.equal(await journal.load(), null);
  }
  assert.deepEqual(methods, [
    "POST",
    "GET",
    "POST",
    "GET",
    "POST",
    "GET",
    "POST",
    "GET",
  ]);
  current = false;
  await assert.rejects(make().load(), ApiError);
});
test("书架存储前失败不发请求，提交后落盘失败可重挂恢复，不盲清未知", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const owner = randomUUID();
  const journal = new EncryptedShelfJournal(
    f.rows,
    f.cipher,
    owner,
    () => true,
  );
  const write: ShelfWrite = {
    mutation_id: randomUUID(),
    base_revision: 0,
    operation: "join",
  };
  let posts = 0;
  const api = new NovelShelfApi(
    async <T>(_p: string, o?: { method?: string }) => {
      if (o?.method !== "POST")
        throw new ApiError("resource_not_found", "", 404);
      posts++;
      return ack(book, write) as T;
    },
  );
  const make = () =>
    new ShelfOperations(owner, journal, api, () => true, randomUUID);
  let ops = make();
  await ops.load();
  f.db.failBeforeCommit = true;
  await assert.rejects(ops.start(book, write), ApiError);
  assert.equal(posts, 0);
  assert.equal(await journal.load(), null);
  f.db.failAfterCommit = true;
  await assert.rejects(ops.start(book, write), ApiError);
  assert.equal(posts, 0);
  assert.equal((await journal.load())?.input.mutation_id, write.mutation_id);
  ops = make();
  await ops.load();
  await assert.rejects(ops.confirm(), ApiError);
  assert.equal(ops.snapshot().record?.rejection, null);
  await assert.rejects(ops.clear(), ApiError);
  f.db.failAfterCommit = true;
  await assert.rejects(ops.retry(), ApiError);
  assert.equal(posts, 1);
  ops = make();
  await ops.load();
  assert.equal(ops.snapshot().record?.receipt?.mutation_id, write.mutation_id);
  await ops.clear();
  assert.equal(posts, 1);
});
test("同账号两个页面共享书架记录CAS，第二个页面不能覆盖未确认操作", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const owner = randomUUID();
  let posts = 0;
  const api = new NovelShelfApi(
    async <T>(p: string, o?: { method?: string; body?: unknown }) => {
      assert.equal(o?.method, "POST");
      posts++;
      return ack(p.split("/")[3], o?.body as ShelfWrite) as T;
    },
  );
  const journal = () =>
    new EncryptedShelfJournal(f.rows, f.cipher, owner, () => true);
  const a = new ShelfOperations(owner, journal(), api, () => true, randomUUID),
    b = new ShelfOperations(owner, journal(), api, () => true, randomUUID);
  await Promise.all([a.load(), b.load()]);
  const result = await Promise.allSettled([
    a.start(book, {
      mutation_id: randomUUID(),
      base_revision: 0,
      operation: "join",
    }),
    b.start(randomUUID(), {
      mutation_id: randomUUID(),
      base_revision: 0,
      operation: "join",
    }),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(posts, 1);
  assert.ok((await journal().load())?.receipt);
});
test("明确POST拒绝可确认清理，错回执和未知GET404保留原命令", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const owner = randomUUID();
  let rejected = true;
  const write: ShelfWrite = {
    mutation_id: randomUUID(),
    base_revision: 0,
    operation: "join",
  };
  const journal = new EncryptedShelfJournal(
    f.rows,
    f.cipher,
    owner,
    () => true,
  );
  const api = new NovelShelfApi(async <T>() => {
    if (rejected) throw new ApiError("resource_not_found", "", 404);
    return ack(randomUUID(), write) as T;
  });
  const ops = new ShelfOperations(owner, journal, api, () => true, randomUUID);
  await ops.load();
  await assert.rejects(ops.start(book, write), ApiError);
  assert.equal(ops.snapshot().record?.rejection, "resource_not_found");
  await ops.clear();
  rejected = false;
  await assert.rejects(ops.start(book, write), ApiError);
  assert.equal(ops.snapshot().record?.receipt, null);
  assert.equal(ops.snapshot().record?.rejection, null);
  await assert.rejects(ops.clear(), ApiError);
  assert.throws(
    () =>
      checkedShelfRecord(
        { ...ops.snapshot().record, content: "不属于操作记录的正文" },
        owner,
      ),
    ApiError,
  );
});
test("切账号后的迟到结果不落另一账号，密文篡改不换钥或清记录", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const owner = randomUUID(),
    other = randomUUID();
  let current = true,
    drop = true,
    posts = 0;
  const write: ShelfWrite = {
    mutation_id: randomUUID(),
    base_revision: 0,
    operation: "join",
  };
  const journal = new EncryptedShelfJournal(
    f.rows,
    f.cipher,
    owner,
    () => current,
  );
  const api = new NovelShelfApi(
    async <T>(_p: string, o?: { method?: string }) => {
      if (o?.method === "POST") posts++;
      if (drop) {
        current = false;
        drop = false;
      }
      return ack(book, write) as T;
    },
  );
  let ops = new ShelfOperations(owner, journal, api, () => current, randomUUID);
  await ops.load();
  await assert.rejects(ops.start(book, write), ApiError);
  assert.equal(
    await new EncryptedShelfJournal(f.rows, f.cipher, other, () => true).load(),
    null,
  );
  current = true;
  ops = new ShelfOperations(owner, journal, api, () => current, randomUUID);
  await ops.load();
  assert.equal(ops.snapshot().record?.receipt, null);
  await ops.confirm();
  assert.equal(posts, 1);
  const slot = (await f.rows.ids(owner))[0],
    row = (await f.rows.read(owner, slot))!;
  assert.equal(row.ciphertext.includes(write.mutation_id), false);
  await f.rows.update(owner, slot, async (old) => ({
    ...old!,
    revision: old!.revision + 1,
  }));
  const keys = f.cipher.keys.size;
  await assert.rejects(journal.load(), ApiError);
  assert.equal(f.cipher.keys.size, keys);
  assert.equal((await f.rows.ids(owner)).length, 1);
  assert.equal(posts, 1);
});
