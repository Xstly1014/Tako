import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { Session } from "../../auth/session";
import { ApiError } from "../../api/client";
import { DraftError } from "../../drafts/model";
import type { DraftCipher } from "../../drafts/storage";
import { SqliteCipherRows } from "../../drafts/sqlite";
import { AuthorizedDrafts, type LocalIdentity } from "../../drafts/authorized";
import { DraftSynchronizer } from "../../drafts/sync";
import { localAllowed, type DraftTools } from "../../drafts/workspace";
import { ChapterStorage, type CachedChapterBook } from "./storage";
import { chapterDraftsApi } from "./api";
const pendingKeys = new Map<string, Promise<string>>();
async function key(owner: string, allowNew: boolean) {
  const name = "tako.test.chapter-key.v1." + owner;
  const active = pendingKeys.get(name);
  if (active) return active;
  const task = (async () => {
    const stored = await SecureStore.getItemAsync(name);
    if (stored) return stored;
    if (!allowNew) throw new ApiError("storage");
    const generated = await Crypto.AESEncryptionKey.generate(256);
    const encoded = await generated.encoded("hex");
    await SecureStore.setItemAsync(name, encoded, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return encoded;
  })();
  pendingKeys.set(name, task);
  try {
    return await task;
  } finally {
    pendingKeys.delete(name);
  }
}
const cipher: DraftCipher = {
  async seal(owner, context, plaintext, allowNew) {
    const aes = await Crypto.AESEncryptionKey.import(
      await key(owner, allowNew),
      "hex",
    );
    const sealed = await Crypto.aesEncryptAsync(
      new TextEncoder().encode(plaintext),
      aes,
      { additionalData: new TextEncoder().encode(context), tagLength: 16 },
    );
    return sealed.combined("base64");
  },
  async open(owner, context, ciphertext) {
    const aes = await Crypto.AESEncryptionKey.import(
      await key(owner, false),
      "hex",
    );
    const data = await Crypto.aesDecryptAsync(
      Crypto.AESSealedData.fromCombined(ciphertext),
      aes,
      { additionalData: new TextEncoder().encode(context), output: "bytes" },
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  },
};

let storage: Promise<ChapterStorage> | undefined;
function open() {
  if (!storage)
    storage = (async () => {
      const db = await SQLite.openDatabaseAsync(
        "tako-test-private-chapter-drafts-v1.db",
      );
      try {
        const rows = new SqliteCipherRows(db);
        await rows.initialize();
        return new ChapterStorage(rows, cipher);
      } catch {
        await db.closeAsync().catch(() => undefined);
        throw new DraftError("storage");
      }
    })().catch((e) => {
      storage = undefined;
      throw e;
    });
  return storage;
}
async function authorized<T>(
  current: () => LocalIdentity,
  action: (storage: ChapterStorage, owner: string) => Promise<T>,
) {
  const before = current();
  if (!localAllowed(before)) throw new DraftError("account_mismatch");
  const check = () => {
    const now = current();
    if (
      !localAllowed(now) ||
      now.generation !== before.generation ||
      now.drafts.owner !== before.drafts.owner
    )
      throw new DraftError("account_mismatch");
  };
  const db = await open();
  check();
  const value = await action(db, before.drafts.owner!);
  check();
  return value;
}
export const localChapterBooks = (current: () => LocalIdentity) =>
  authorized(current, (db, owner) => db.books(owner));
export const cacheChapterBook = (
  current: () => LocalIdentity,
  book: CachedChapterBook,
) => authorized(current, (db, owner) => db.cacheBook(owner, book));
export const pendingChapterDraftCount = (current: () => LocalIdentity) =>
  authorized(current, (db, owner) => db.pending(owner));
const bySession = new WeakMap<Session, Map<string, DraftTools>>();
export function nativeChapterTools(session: Session, book: string): DraftTools {
  let tools = bySession.get(session);
  if (!tools) {
    tools = new Map();
    bySession.set(session, tools);
  }
  const existing = tools.get(book);
  if (existing) return existing;
  const api = chapterDraftsApi(
    (path, options) => session.authorized(path, options),
    book,
  );
  const identity = () => ({
    owner: session.snapshot().drafts.owner,
    generation: session.snapshot().generation,
    online:
      !session.snapshot().busy && session.snapshot().drafts.phase === "online",
  });
  const repository = async () => (await open()).repository(book);
  let sync: Promise<DraftSynchronizer> | undefined;
  const value: DraftTools = {
    channel: "chapter",
    local: new AuthorizedDrafts(repository, session.snapshot),
    api,
    current: session.snapshot,
    online: () => session.reconnectDrafts(),
    uuid: Crypto.randomUUID,
    async sync(localId) {
      const now = identity();
      if (!now.owner || !now.online) return { state: "login-required" };
      if (!sync)
        sync = repository()
          .then(
            (repo) =>
              new DraftSynchronizer(repo, api, identity, Crypto.randomUUID),
          )
          .catch((e) => {
            sync = undefined;
            throw e;
          });
      return (await sync).sync(now.owner, localId);
    },
  };
  tools.set(book, value);
  return value;
}
