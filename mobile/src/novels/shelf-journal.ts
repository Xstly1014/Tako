import { ApiError } from "../api/client.ts";
import { id } from "../drafts/model.ts";
import type { CipherRows, DraftCipher } from "../drafts/storage.ts";
import {
  checkedShelfRecord,
  type ShelfJournal,
  type ShelfRecord,
} from "./shelf-requests.ts";
const slot = "e6112c49-76e3-470b-b813-d6816a95c1e4";
export class EncryptedShelfJournal implements ShelfJournal {
  private rows: CipherRows;
  private cipher: DraftCipher;
  private owner: string;
  private current: () => boolean;
  constructor(
    rows: CipherRows,
    cipher: DraftCipher,
    owner: string,
    current: () => boolean,
  ) {
    if (!id(owner)) throw new ApiError("invalid_input");
    this.rows = rows;
    this.cipher = cipher;
    this.owner = owner;
    this.current = current;
  }
  private guard() {
    if (!this.current()) throw new ApiError("stale_session");
  }
  private context(revision: number) {
    return `tako.novel-shelf-request.v1/${this.owner}/${slot}/${revision}`;
  }
  private async decode(row: { revision: number; ciphertext: string }) {
    if (!Number.isSafeInteger(row.revision) || row.revision < 1)
      throw new ApiError("storage");
    const v = checkedShelfRecord(
      JSON.parse(
        await this.cipher.open(
          this.owner,
          this.context(row.revision),
          row.ciphertext,
        ),
      ),
      this.owner,
    );
    this.guard();
    return v;
  }
  async load() {
    this.guard();
    try {
      const row = await this.rows.read(this.owner, slot);
      this.guard();
      return row ? await this.decode(row) : null;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("storage");
    }
  }
  async save(value: ShelfRecord | null, expectedToken: string | null) {
    this.guard();
    checkedShelfRecord(value, this.owner);
    if (expectedToken !== null && !id(expectedToken))
      throw new ApiError("invalid_input");
    try {
      await this.rows.update(this.owner, slot, async (row) => {
        this.guard();
        const old = row ? await this.decode(row) : null;
        if ((old?.token ?? null) !== expectedToken)
          throw new ApiError("novel_request_pending");
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
