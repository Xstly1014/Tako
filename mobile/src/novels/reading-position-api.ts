import type { components } from "../api/contract";
import type { Transport } from "../auth/session.ts";
import { ApiError } from "../api/client.ts";
import { date, id, integer } from "../drafts/model.ts";
export type ReadingPosition = components["schemas"]["ReadingPosition"];
export type ReadingState = {
  position: ReadingPosition | null;
  readable: boolean;
  current_version: number | null;
};
export type ReadingWrite = components["schemas"]["ReadingWrite"];
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...keys].sort().join(",");
function locator(v: unknown): boolean {
  return (
    shape(v, ["algorithm", "paragraph", "offset"]) &&
    v.algorithm === 1 &&
    integer(v.paragraph) &&
    integer(v.offset)
  );
}
export function checkedReadingPosition(
  v: unknown,
  book: string,
): ReadingPosition {
  if (
    !shape(v, [
      "novel_id",
      "chapter_id",
      "version",
      "locator",
      "revision",
      "saved_at",
    ]) ||
    !id(v.novel_id) ||
    v.novel_id !== book ||
    !id(v.chapter_id) ||
    !integer(v.version, 1) ||
    !integer(v.revision, 1) ||
    !date(v.saved_at) ||
    !locator(v.locator)
  )
    throw new ApiError("contract");
  return v as ReadingPosition;
}
function checkedWrite(v: ReadingWrite) {
  if (
    !shape(v, [
      "mutation_id",
      "base_revision",
      "chapter_id",
      "version",
      "locator",
    ]) ||
    !id(v.mutation_id) ||
    !integer(v.base_revision) ||
    v.base_revision === Number.MAX_SAFE_INTEGER ||
    !id(v.chapter_id) ||
    !integer(v.version, 1) ||
    !locator(v.locator)
  )
    throw new ApiError("invalid_input");
}
export class ReadingPositionApi {
  private transport: Transport;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  private root(book: string) {
    if (!id(book)) throw new ApiError("invalid_input");
    return "/my/novel-reading/" + book;
  }
  async read(book: string): Promise<ReadingState> {
    const v = await this.transport<unknown>(this.root(book));
    if (
      !shape(v, ["position", "readable", "current_version"]) ||
      typeof v.readable !== "boolean"
    )
      throw new ApiError("contract");
    const position =
      v.position === null ? null : checkedReadingPosition(v.position, book);
    if (
      v.readable
        ? !position ||
          !integer(v.current_version, 1) ||
          Number(v.current_version) < position.version
        : v.current_version !== null
    )
      throw new ApiError("contract");
    if (!position && v.readable) throw new ApiError("contract");
    return {
      position,
      readable: v.readable,
      current_version: v.current_version as number | null,
    };
  }
  private result(v: unknown, book: string, input?: ReadingWrite) {
    const p = checkedReadingPosition(v, book);
    if (
      input &&
      (p.chapter_id !== input.chapter_id ||
        p.version !== input.version ||
        p.revision !== input.base_revision + 1 ||
        p.locator.algorithm !== input.locator.algorithm ||
        p.locator.paragraph !== input.locator.paragraph ||
        p.locator.offset !== input.locator.offset)
    )
      throw new ApiError("contract");
    return p;
  }
  async save(book: string, input: ReadingWrite) {
    const path = this.root(book);
    checkedWrite(input);
    return this.result(
      await this.transport<unknown>(path, { method: "POST", body: input }),
      book,
      input,
    );
  }
  async receipt(book: string, mutation: string, input?: ReadingWrite) {
    const path = this.root(book);
    if (!id(mutation) || (input && input.mutation_id !== mutation))
      throw new ApiError("invalid_input");
    if (input) checkedWrite(input);
    return this.result(
      await this.transport<unknown>(path + "/requests/" + mutation),
      book,
      input,
    );
  }
}
