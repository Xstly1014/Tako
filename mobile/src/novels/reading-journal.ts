import { ApiError } from "../api/client.ts";
import { id } from "../drafts/model.ts";
import type { CipherRows, DraftCipher } from "../drafts/storage.ts";
import {
  checkedReadingRecord,
  type ReadingJournal,
  type ReadingRecord,
} from "./reading-sync.ts";
export class EncryptedReadingJournal implements ReadingJournal {
  private rows: CipherRows;
  private cipher: DraftCipher;
  private owner: string;
  private current: () => boolean;
  private book: string;
  constructor(
    rows: CipherRows,
    cipher: DraftCipher,
    owner: string,
    current: () => boolean,
    book: string,
  ) {
    if (!id(owner) || !id(book)) throw new ApiError("invalid_input");
    this.rows = rows;
    this.cipher = cipher;
    this.owner = owner;
    this.book = book;
    this.current = current;
  }
  private guard() {
    if (!this.current()) throw new ApiError("stale_session");
  }
  private context(revision: number) {
    return `tako.novel-reading-position.v1/${this.owner}/${this.book}/${revision}`;
  }
  private async decode(row: { revision: number; ciphertext: string }) {
    if (!Number.isSafeInteger(row.revision) || row.revision < 1)
      throw new ApiError("storage");
    const v = checkedReadingRecord(
      JSON.parse(
        await this.cipher.open(
          this.owner,
          this.context(row.revision),
          row.ciphertext,
        ),
      ),
      this.owner,
      this.book,
    );
    this.guard();
    return v;
  }
  async load() {
    this.guard();
    try {
      const row = await this.rows.read(this.owner, this.book);
      this.guard();
      return row ? await this.decode(row) : null;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("storage");
    }
  }
  async save(value: ReadingRecord | null, expectedToken: string | null) {
    this.guard();
    checkedReadingRecord(value, this.owner, this.book);
    if (expectedToken !== null && !id(expectedToken))
      throw new ApiError("invalid_input");
    try {
      await this.rows.update(this.owner, this.book, async (row) => {
        this.guard();
        const old = row ? await this.decode(row) : null;
        if ((old?.token ?? null) !== expectedToken)
          throw new ApiError("reading_local_conflict");
        if (row && row.revision >= Number.MAX_SAFE_INTEGER)
          throw new ApiError("storage");
        const revision = (row?.revision ?? 0) + 1;
        const ciphertext = await this.cipher.seal(
          this.owner,
          this.context(revision),
          JSON.stringify(value),
          !row && (await this.rows.ids(this.owner)).length === 0,
        );
        this.guard();
        return { revision, ciphertext };
      });
      this.guard();
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("storage");
    }
  }
}
