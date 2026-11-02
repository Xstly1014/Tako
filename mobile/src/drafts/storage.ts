import { checkedLocal, DraftError, id, text, type LocalDraft } from "./model.ts";

export type CipherRow = { revision: number; ciphertext: string };
export interface CipherRows {
  read(owner: string, localId: string): Promise<CipherRow | null>;
  ids(owner: string): Promise<string[]>;
  // Must commit the returned row atomically or preserve the previous row on failure.
  update(owner: string, localId: string, transform: (row: CipherRow | null) => Promise<CipherRow>): Promise<void>;
}
export interface DraftCipher {
  seal(owner: string, context: string, plaintext: string, allowNewKey: boolean): Promise<string>;
  open(owner: string, context: string, ciphertext: string): Promise<string>;
}
const context = (owner: string, localId: string, revision: number) => `tako.private-draft.v1/${owner}/${localId}/${revision}`;
export class DraftRepository {
  private rows: CipherRows;
  private cipher: DraftCipher;
  constructor(rows: CipherRows, cipher: DraftCipher) { this.rows = rows; this.cipher = cipher; }
  private async decode(owner: string, localId: string, row: CipherRow): Promise<LocalDraft> {
    try {
      if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new DraftError("unreadable");
      return checkedLocal(JSON.parse(await this.cipher.open(owner, context(owner, localId, row.revision), row.ciphertext)), owner, localId);
    } catch { throw new DraftError("unreadable"); }
  }
  async load(owner: string, localId: string) {
    if (!id(owner) || !id(localId)) throw new DraftError("invalid_input");
    try {
      const row = await this.rows.read(owner, localId);
      return row ? await this.decode(owner, localId, row) : null;
    } catch (e) { if (e instanceof DraftError) throw e; throw new DraftError("storage"); }
  }
  async list(owner: string) {
    if (!id(owner)) throw new DraftError("invalid_input");
    try {
      const keys = await this.rows.ids(owner);
      return await Promise.all(keys.map((key) => this.load(owner, key)));
    } catch (e) { if (e instanceof DraftError) throw e; throw new DraftError("storage"); }
  }
  async change(owner: string, localId: string, transform: (current: LocalDraft | null) => LocalDraft) {
    if (!id(owner) || !id(localId)) throw new DraftError("invalid_input");
    let result: LocalDraft | undefined;
    try {
      await this.rows.update(owner, localId, async (row) => {
        const current = row ? await this.decode(owner, localId, row) : null;
        const next = checkedLocal(transform(current), owner, localId);
        const revision = (row?.revision ?? 0) + 1;
        // Missing keys may only be created before the owner's first encrypted record.
        const allowNewKey = !row && (await this.rows.ids(owner)).length === 0;
        const ciphertext = await this.cipher.seal(owner, context(owner, localId, revision), JSON.stringify(next), allowNewKey);
        result = next;
        return { revision, ciphertext };
      });
      return result!;
    } catch (e) { if (e instanceof DraftError) throw e; throw new DraftError("storage"); }
  }
  create(owner: string, localId: string, title = "", content = "") {
    if (!text(title, content)) throw new DraftError("invalid_input");
    return this.change(owner, localId, (current) => {
      if (current) throw new DraftError("local_conflict");
      return { format: 1, owner, id: localId, seq: 1, serverId: null, baseRevision: 0,
        title, content, dirty: true, pending: null, savedAt: null, recoveredFrom: null };
    });
  }
  edit(owner: string, localId: string, expectedSeq: number, title: string, content: string) {
    if (!text(title, content)) throw new DraftError("invalid_input");
    return this.change(owner, localId, (current) => {
      if (!current || current.seq !== expectedSeq) throw new DraftError("local_conflict");
      return { ...current, seq: current.seq + 1, title, content, dirty: true };
    });
  }
}
