import type { components } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "../api/client.ts";
import { id, integer, date } from "../drafts/model.ts";
import { checkedPublicNovel } from "./reading-api.ts";
export type ShelfState = components["schemas"]["NovelShelfState"];
export type ShelfWrite = components["schemas"]["NovelShelfWrite"];
export type ShelfReceipt = components["schemas"]["NovelShelfReceipt"];
export type ShelfPage = components["schemas"]["NovelShelfPage"];
const fail = (): never => {
  throw new ApiError("contract");
};
const shape = (v: unknown, keys: string[]) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const ops = ["join", "follow", "unfollow", "remove"];
const cursor = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 512 && /^[A-Za-z0-9_-]*$/.test(s);
export function checkedShelfState(v: ShelfState, book?: string) {
  if (
    !shape(v, [
      "novel_id",
      "in_shelf",
      "following",
      "revision",
      "generation",
      "added_at",
      "updated_at",
    ]) ||
    !id(v.novel_id) ||
    (book !== undefined && book !== v.novel_id) ||
    typeof v.in_shelf !== "boolean" ||
    typeof v.following !== "boolean" ||
    !integer(v.revision, 0) ||
    !integer(v.generation, 0) ||
    v.generation > v.revision ||
    (v.following && !v.in_shelf)
  )
    fail();
  if (v.revision === 0) {
    if (
      v.in_shelf ||
      v.following ||
      v.generation !== 0 ||
      v.added_at !== null ||
      v.updated_at !== null
    )
      fail();
  } else if (
    v.generation === 0 ||
    !date(v.added_at) ||
    !date(v.updated_at) ||
    Date.parse(v.added_at!) > Date.parse(v.updated_at!)
  )
    fail();
  return v;
}
export function checkedShelfWrite(book: string, v: ShelfWrite) {
  if (
    !id(book) ||
    !shape(v, ["mutation_id", "base_revision", "operation"]) ||
    !id(v.mutation_id) ||
    !integer(v.base_revision, 0) ||
    v.base_revision >= Number.MAX_SAFE_INTEGER ||
    !ops.includes(v.operation)
  )
    throw new ApiError("invalid_input");
}
export function checkedShelfReceipt(
  v: ShelfReceipt,
  book: string,
  input: ShelfWrite,
) {
  checkedShelfWrite(book, input);
  if (
    !shape(v, ["mutation_id", "operation", "state", "accepted_at"]) ||
    v.mutation_id !== input.mutation_id ||
    v.operation !== input.operation ||
    !date(v.accepted_at)
  )
    fail();
  const state = checkedShelfState(v.state, book);
  if (
    state.revision !== input.base_revision + 1 ||
    state.updated_at !== v.accepted_at
  )
    fail();
  const expected = input.operation === "join" || input.operation === "follow";
  if (
    state.following !== expected ||
    state.in_shelf !== (input.operation !== "remove")
  )
    fail();
  return v;
}
/** No retry POST is implicit here. The UI must first persist its account-bound command. */
export class NovelShelfApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  async state(book: string, signal?: AbortSignal) {
    if (!id(book)) throw new ApiError("invalid_input");
    return checkedShelfState(
      await this.transport<ShelfState>(`/my/novel-shelf/${book}`, { signal }),
      book,
    );
  }
  async write(book: string, input: ShelfWrite, signal?: AbortSignal) {
    checkedShelfWrite(book, input);
    return checkedShelfReceipt(
      await this.transport<ShelfReceipt>(`/my/novel-shelf/${book}`, {
        method: "POST",
        body: input,
        signal,
      }),
      book,
      input,
    );
  }
  async receipt(book: string, input: ShelfWrite, signal?: AbortSignal) {
    checkedShelfWrite(book, input);
    return checkedShelfReceipt(
      await this.transport<ShelfReceipt>(
        `/my/novel-shelf/${book}/requests/${input.mutation_id}`,
        { signal },
      ),
      book,
      input,
    );
  }
  async list(token = "", signal?: AbortSignal) {
    if (!cursor(token)) throw new ApiError("invalid_input");
    const v = await this.transport<ShelfPage>(
      "/my/novel-shelf" + (token ? "?cursor=" + encodeURIComponent(token) : ""),
      { signal },
    );
    if (
      !shape(v, ["items", "next_cursor"]) ||
      !Array.isArray(v.items) ||
      v.items.length > 12 ||
      !cursor(v.next_cursor) ||
      (token && v.next_cursor === token) ||
      new Set(v.items.map((i) => i?.relation?.novel_id)).size !== v.items.length
    )
      fail();
    for (const item of v.items) {
      if (!shape(item, ["relation", "book"])) fail();
      const state = checkedShelfState(item.relation);
      if (!state.in_shelf) fail();
      if (item.book !== null) {
        if (
          !shape(item.book, [
            "id",
            "title",
            "introduction",
            "tags",
            "author",
            "completed",
            "chapter_count",
            "first_published_at",
            "latest_chapter_published_at",
          ])
        )
          fail();
        checkedPublicNovel(item.book, state.novel_id);
      }
    }
    return v;
  }
}
