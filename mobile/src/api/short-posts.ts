import type { components } from "./contract";
import { ApiError, apiMessage, request } from "./client.ts";
import { API_BASE, UUID } from "./reader.ts";

type Schemas = components["schemas"];
export type ShortPostFeed = Schemas["ShortPostFeedPage"];
export type ShortPostCard = ShortPostFeed["items"][number];
export type ShortPost = Schemas["PublicShortPost"];
export type ShortPostImage = Schemas["ShortPostImage"];
export type ShortPostVersion = Schemas["ShortPostVersionNode"];

const versionNumber = (value: number) => Number.isSafeInteger(value) && value > 0;
const date = (value: string) => typeof value === "string" && Number.isFinite(Date.parse(value));
const isImage = (value: ShortPostImage) =>
  !!value &&
  UUID.test(value.id) &&
  (value.media_type === "image/jpeg" || value.media_type === "image/png") &&
  versionNumber(value.width) &&
  versionNumber(value.height) &&
  value.width * value.height <= 12000000;

export async function shortPostFeed(cursor = "", signal?: AbortSignal) {
  if (cursor && !UUID.test(cursor)) throw new ApiError("invalid_input");
  const page = await request<ShortPostFeed>(
    "/short-posts" + (cursor ? "?cursor=" + cursor : ""),
    { signal },
  );
  if (
    !page ||
    typeof page.next_cursor !== "string" ||
    (page.next_cursor !== "" && (!UUID.test(page.next_cursor) || page.next_cursor === cursor)) ||
    !Array.isArray(page.items) ||
    page.items.length > 12 ||
    !page.items.every((item) =>
      item && UUID.test(item.id) && typeof item.title === "string" &&
      typeof item.excerpt === "string" && typeof item.author === "string" &&
      versionNumber(item.version) && date(item.published_at) &&
      (item.cover === null || isImage(item.cover)),
    ) ||
    new Set(page.items.map(({ id }) => id)).size !== page.items.length
  ) throw new ApiError("contract");
  return page;
}

export async function readShortPost(id: string, version?: number, signal?: AbortSignal) {
  if (!UUID.test(id) || (version !== undefined && !versionNumber(version)))
    throw new ApiError("resource_not_found");
  const post = await request<ShortPost>(
    "/short-posts/" + id + (version ? "/versions/" + version : ""),
    { signal },
  );
  if (
    !post || post.id !== id ||
    !versionNumber(post.version) || (version !== undefined && post.version !== version) ||
    typeof post.title !== "string" || typeof post.content !== "string" ||
    typeof post.author !== "string" || !date(post.published_at) ||
    !Array.isArray(post.images) || post.images.length > 4 ||
    !post.images.every(isImage) ||
    new Set(post.images.map((image) => image.id)).size !== post.images.length ||
    (post.novel !== null && (!post.novel || !UUID.test(post.novel.id) || typeof post.novel.title !== "string"))
  ) throw new ApiError("contract");
  return post;
}

export async function listShortPostVersions(id: string, before: number, signal?: AbortSignal) {
  if (!UUID.test(id) || (before !== 0 && !versionNumber(before)))
    throw new ApiError("invalid_input");
  const nodes = await request<ShortPostVersion[]>(
    "/short-posts/" + id + "/versions" + (before ? "?before=" + before : ""),
    { signal },
  );
  if (
    !Array.isArray(nodes) || nodes.length > 20 ||
    !nodes.every((node, index) =>
      node && versionNumber(node.version) && date(node.published_at) &&
      typeof node.readable === "boolean" && (!before || node.version < before) &&
      (!index || node.version < nodes[index - 1].version),
    )
  ) throw new ApiError("contract");
  return nodes;
}

export function shortPostImageUri(post: string, version: number, image: string, readId: string) {
  if (!UUID.test(post) || !versionNumber(version) || !UUID.test(image) || !UUID.test(readId))
    throw new ApiError("contract");
  // A fresh read uses a distinct native image cache key even for the same published version.
  return API_BASE + "/short-posts/" + post + "/versions/" + version +
    "/images/" + image + "?read=" + readId;
}

export function shortPostMessage(error: unknown) {
  return error instanceof ApiError && error.status === 404
    ? "这条短帖或版本已不可读。"
    : apiMessage(error);
}
