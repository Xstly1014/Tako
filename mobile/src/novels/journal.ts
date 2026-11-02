import { ApiError } from "../api/client.ts";
import type { CipherRows, DraftCipher } from "../drafts/storage.ts";
import {
  checkedPending,
  type BookJournal,
  type PendingBook,
} from "./writer.ts";
const slot = "d2645a08-4e13-4bb3-a150-aa10ff20c2c5";
export class EncryptedBookJournal implements BookJournal {
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
    this.rows = rows;
    this.cipher = cipher;
    this.owner = owner;
    this.current = current;
  }
  private guard() {
    if (!this.current()) throw new ApiError("stale_session");
  }
  private context(revision: number) {
    return `tako.private-book-request.v1/${this.owner}/${revision}`;
  }
  async load() {
    this.guard();
    try {
      const row = await this.rows.read(this.owner, slot);
      this.guard();
      if (!row) return null;
      if (!Number.isSafeInteger(row.revision) || row.revision < 1)
        throw new ApiError("storage");
      const pending = checkedPending(
        JSON.parse(
          await this.cipher.open(
            this.owner,
            this.context(row.revision),
            row.ciphertext,
          ),
        ),
      );
      this.guard();
      return pending;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("storage");
    }
  }
  async save(value: PendingBook | null, expectedId?: string) {
    this.guard();
    checkedPending(value);
    try {
      await this.rows.update(this.owner, slot, async (row) => {
        this.guard();
        // Read old ciphertext before overwriting: missing/wrong keys must not erase a pending request.
        if (row) {
          if (
            !Number.isSafeInteger(row.revision) ||
            row.revision < 1 ||
            row.revision >= Number.MAX_SAFE_INTEGER
          )
            throw new ApiError("storage");
          const pending = checkedPending(
            JSON.parse(
              await this.cipher.open(
                this.owner,
                this.context(row.revision),
                row.ciphertext,
              ),
            ),
          );
          if (
            pending &&
            ((value && JSON.stringify(pending) !== JSON.stringify(value)) ||
              (!value && pending.input.mutation_id !== expectedId))
          )
            throw new ApiError("novel_request_pending");
        }
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
