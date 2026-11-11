import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, request, type RequestOptions } from "../src/api/client.ts";
import {
  changePost, filePostAppeal, isDefiniteChangeError, ownerPage, ownerVersion, ownerVersions, readOwnerImage, reviewLabel,
} from "../src/short-posts/manage.ts";

const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-11-11T00:00:00Z";
const state = { id, state_revision: 1, review_status: "pending" as const,
  published_at: null, author_hidden: false, platform_limited: false };

test("作者短帖列表保留先审与后审差别并拒绝重复游标", async () => {
  const item = { ...state, title: "已提交短帖", submitted_at: at, display_version: 0 };
  const send = async <T>() => ({ items: [item], next_cursor: id }) as T;
  assert.equal(reviewLabel((await ownerPage(send, "")).items[0]), "待先审");
  assert.equal(reviewLabel({ ...state, published_at: at }), "已发布 · 待后审");
  await assert.rejects(ownerPage(send, id), /contract/);
});

test("处置动作绑定目标和状态版本，明确冲突与未确认分别处理", async () => {
  const change = { mutation_id: id, expected_revision: 1, action: "hide" as const };
  const send = async <T>(path: string, options?: RequestOptions) => {
    assert.equal(path, "/my/short-posts/" + id + "/actions");
    assert.deepEqual(options?.body, change);
    return { ...state, state_revision: 2, author_hidden: true } as T;
  };
  await changePost(send, id, change);
  assert.ok(isDefiniteChangeError(new ApiError("work_state_conflict", "", 409)));
  assert.ok(!isDefiniteChangeError(new ApiError("network")));
  await assert.rejects(ownerVersion(async <T>() => ({
    id, version: 1, platform_limited: false, review_reason: "",
  }) as T, id, 2), /contract/);
});

test("本人配图只接受测试环境的已认证图片响应", async ({ mock }) => {
  const picture = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  const fetch = mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-token");
    return new Response(picture, {
      headers: { "X-Tako-Environment": "test", "Content-Type": "image/png" },
    });
  });
  const authorized = <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, token: "synthetic-token" });
  const blob = await readOwnerImage(authorized, id);
  assert.equal(blob.size, picture.size);
  fetch.mock.mockImplementation(async () => Response.json({ error: "resource_not_found" }, {
    status: 404, headers: { "X-Tako-Environment": "test" },
  }));
  await assert.rejects(readOwnerImage(authorized, id), /resource_not_found/);
  fetch.mock.mockImplementation(async () => new Response(picture, {
    headers: { "X-Tako-Environment": "test", "Content-Type": "text/html" },
  }));
  await assert.rejects(readOwnerImage(authorized, id), /contract/);
});

test("受限版本在作者时间线保留，复核回执须匹配原处置轮次", async () => {
  const read = async <T>() => [{ version: 4, platform_limited: true, published_at: at }] as T;
  assert.equal((await ownerVersions(read, id))[0].platform_limited, true);
  await assert.rejects(ownerVersions(read, id, 4), /contract/);
  const send = async <T>(path: string, options?: RequestOptions) => {
    assert.equal(path, "/my/short-posts/" + id + "/appeals/" + id);
    assert.deepEqual(options?.body, { case_revision: 8, reason: "补充说明" });
    return { id, post_id: id, case_revision: 7, version: 4, state: "pending",
      reason: "补充说明", case_reason: "处置原因", decision_reason: "", submitted_at: at, decided_at: null } as T;
  };
  await assert.rejects(filePostAppeal(send, id, id, 8, "补充说明"), /contract/);
});
