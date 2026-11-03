import {
  DraftRepository,
  type CipherRows,
  type DraftCipher,
} from "../../drafts/storage.ts";
import { DraftError, id, integer } from "../../drafts/model.ts";
export type CachedChapterBook = { id: string; title: string };
// Separate encrypted domain; existing C1 record format and database stay intact.
export class ChapterStorage {
  private rows: CipherRows;
  private cipher: DraftCipher;
  constructor(rows: CipherRows, cipher: DraftCipher) {
    this.rows = rows;
    this.cipher = cipher;
  }
  private book(value: unknown, expected: string): CachedChapterBook {
    const v = value as CachedChapterBook;
    if (
      !v ||
      v.id !== expected ||
      !id(v.id) ||
      typeof v.title !== "string" ||
      Array.from(v.title).length > 200
    )
      throw new DraftError("unreadable");
    return v;
  }
  private context(owner: string, book: string, revision: number) {
    return `tako.chapter-book.v1/${owner}/${book}/${revision}`;
  }
  async cacheBook(owner: string, book: CachedChapterBook) {
    if (!id(owner) || !id(book.id)) throw new DraftError("invalid_input");
    this.book(book, book.id);
    await this.rows.update(owner, "book/" + book.id, async (row) => {
      if (row) {
        if (!integer(row.revision, 1)) throw new DraftError("unreadable");
        this.book(
          JSON.parse(
            await this.cipher.open(
              owner,
              this.context(owner, book.id, row.revision),
              row.ciphertext,
            ),
          ),
          book.id,
        );
      }
      const revision = (row?.revision ?? 0) + 1;
      if (!integer(revision, 1)) throw new DraftError("storage");
      const ciphertext = await this.cipher.seal(
        owner,
        this.context(owner, book.id, revision),
        JSON.stringify(book),
        !row && (await this.rows.ids(owner)).length === 0,
      );
      return { revision, ciphertext };
    });
  }
  async books(owner: string) {
    if (!id(owner)) throw new DraftError("invalid_input");
    const out: CachedChapterBook[] = [];
    for (const key of await this.rows.ids(owner)) {
      if (!key.startsWith("book/")) continue;
      const book = key.slice(5),
        row = await this.rows.read(owner, key);
      if (!id(book) || !row || !integer(row.revision, 1))
        throw new DraftError("unreadable");
      out.push(
        this.book(
          JSON.parse(
            await this.cipher.open(
              owner,
              this.context(owner, book, row.revision),
              row.ciphertext,
            ),
          ),
          book,
        ),
      );
    }
    return out;
  }
  repository(book: string) {
    if (!id(book)) throw new DraftError("invalid_input");
    const prefix = `draft/${book}/`,
      rows = this.rows,
      cipher = this.cipher;
    const scoped: CipherRows = {
      read: (owner, key) => rows.read(owner, prefix + key),
      ids: async (owner) =>
        (await rows.ids(owner))
          .filter((x) => x.startsWith(prefix))
          .map((x) => x.slice(prefix.length)),
      update: (owner, key, fn) => rows.update(owner, prefix + key, fn),
    };
    const encryption: DraftCipher = {
      seal: async (owner, context, plain, allowNew) =>
        cipher.seal(
          owner,
          `tako.chapter-draft.v1/${book}/${context}`,
          plain,
          allowNew && (await rows.ids(owner)).length === 0,
        ),
      open: (owner, context, data) =>
        cipher.open(owner, `tako.chapter-draft.v1/${book}/${context}`, data),
    };
    return new DraftRepository(scoped, encryption);
  }
  async pending(owner: string) {
    const books = new Set<string>();
    for (const key of await this.rows.ids(owner)) {
      const parts = key.split("/");
      if (parts[0] === "draft" && id(parts[1])) books.add(parts[1]);
    }
    let count = 0;
    for (const book of books) {
      const records = await this.repository(book).list(owner);
      count += records.filter((x) => x?.dirty || x?.pending).length;
    }
    return count;
  }
}
