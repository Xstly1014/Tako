import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, request } from "../src/api/client.ts";
import { preparePost, ShortPostSubmission, type Receipt } from "../src/short-posts/publish.ts";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const owner = id(1), preview = id(2), mutation = id(3);
const receipt: Receipt = {
  id: mutation, preview_id: preview, post_id: id(4), status: "published",
  submitted_at: "2026-11-11T01:00:00Z",
};

function store() {
  let data: string | null = null;
  return { get: async () => data, set: async (value: string) => { data = value; },
    remove: async () => { data = null; } };
}

test("首次提交响应丢失后，同账号用原编号读取并确认回执", async () => {
  const journal = store();
  let committed = false;
  const send = async <T>(path: string, options?: { method?: string; body?: unknown }) => {
    assert.ok((await journal.get())?.includes(mutation));
    assert.ok(path.endsWith(mutation));
    if (options?.method === "PUT") {
      assert.deepEqual(options.body, { preview_id: preview, rights_confirmed: true });
      committed = true;
      throw new ApiError("network");
    }
    if (committed) return receipt as T;
    throw new ApiError("resource_not_found", "", 404);
  };
  await assert.rejects(new ShortPostSubmission(owner, send, journal).confirm(mutation, preview), /network/);
  const resumed = new ShortPostSubmission(owner, send, journal);
  assert.deepEqual(await resumed.recover(), { pending: true, receipt });
  await assert.rejects(new ShortPostSubmission(id(5), send, journal).recover(), /storage/);
  await assert.rejects(resumed.confirm(id(8), preview), /short_post_pending/);
  await resumed.acknowledge(receipt);
  assert.deepEqual(await resumed.recover(), { pending: false });
});

test("原提交明确过期后才能重新准备，期间未确认的 GET 保留原编号", async () => {
  const journal = store();
  const send = async <T>(_path: string, options?: { method?: string }): Promise<T> => {
    if (options?.method === "PUT" && await journal.get()) throw new ApiError("preview_expired", "", 410);
    throw new ApiError("resource_not_found", "", 404);
  };
  await journal.set(JSON.stringify({ owner, id: mutation, preview }));
  const flow = new ShortPostSubmission(owner, send, journal);
  assert.deepEqual(await flow.recover(), { pending: true });
  await assert.rejects(flow.retry(), /preview_expired/);
  assert.deepEqual(await flow.recover(), { pending: false });
});

test("固定预览按上传顺序校验图片；二进制传输仍核对会话头及测试环境", async () => {
  const imageIds = [id(7), id(8)];
  const input = { title: "短帖", content: "内容", novel_id: null, image_ids: imageIds };
  const send = async <T>() => ({
    id: preview, title: input.title, content: input.content, novel_id: null,
    expires_at: "2026-11-12T00:00:00Z", images: [...imageIds].reverse().map((id) => ({ id })),
  }) as T;
  await assert.rejects(preparePost(send, preview, input), /contract/);
  await assert.rejects(request("/my/short-post-images/" + id(7), {
    method: "PUT", token: "synthetic",
    binary: {
      mediaType: "image/png",
      send: async (_url, init) => {
        const headers = new Headers(init.headers);
        assert.equal(headers.get("Authorization"), "Bearer synthetic");
        assert.equal(headers.get("Content-Type"), "image/png");
        assert.equal(init.credentials, "omit");
        return Response.json({}, { headers: { "X-Tako-Environment": "production" } });
      },
    },
  }), /environment/);
});

test("同帖修订绑定原提交编号和状态版本，丢响应后查同一修订", async () => {
  const journal = store();
  const target = { post: receipt.post_id, expectedRevision: 7 };
  let sent = false;
  const send = async <T>(path: string, options?: { method?: string; body?: unknown }) => {
    assert.equal(path, "/my/short-posts/" + target.post + "/revisions/" + mutation);
    if (options?.method === "PUT") {
      assert.deepEqual(options.body, { preview_id: preview, rights_confirmed: true, expected_revision: 7 });
      sent = true;
      throw new ApiError("network");
    }
    assert.ok(sent);
    return receipt as T;
  };
  await assert.rejects(new ShortPostSubmission(owner, send, journal).confirm(mutation, preview, undefined, target), /network/);
  const resumed = new ShortPostSubmission(owner, send, journal);
  assert.deepEqual(await resumed.recover(), { pending: true, receipt });
  await resumed.acknowledge(receipt);
  assert.deepEqual(await resumed.recover(), { pending: false });
});

test("修订明确过时后释放原请求，要求作者重新确认状态版本", async () => {
  const journal = store();
  const send = async <T>(): Promise<T> => { throw new ApiError("work_state_conflict", "", 409); };
  const flow = new ShortPostSubmission(owner, send, journal);
  await assert.rejects(flow.confirm(mutation, preview, undefined, { post: receipt.post_id, expectedRevision: 7 }), /work_state_conflict/);
  assert.deepEqual(await flow.recover(), { pending: false });
});
