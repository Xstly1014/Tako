import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { Session } from "../auth/session";
import { ApiError } from "../api/client";
import type { DraftCipher, CipherRows } from "../drafts/storage";
import { SqliteCipherRows } from "../drafts/sqlite";
import { EncryptedNovelManagementJournal } from "./management-journal";
import { EncryptedBookJournal } from "./journal";
import { EncryptedChapterPublicationJournal } from "./chapters/publication-journal";
const pendingKeys = new Map<string, Promise<string>>();
async function key(owner: string, allowNew: boolean) {
  const name = "tako.test.book-request-key.v1." + owner;
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
let rows: Promise<CipherRows> | undefined;
function openRows() {
  if (!rows)
    rows = (async () => {
      const db = await SQLite.openDatabaseAsync(
        "tako-test-private-book-requests-v1.db",
      );
      try {
        const result = new SqliteCipherRows(db);
        await result.initialize();
        return result;
      } catch {
        await db.closeAsync().catch(() => undefined);
        throw new ApiError("storage");
      }
    })().catch((e) => {
      rows = undefined;
      throw e;
    });
  return rows;
}
export function nativeBookJournal(session: Session) {
  const initial = session.snapshot(),
    owner = initial.account?.id;
  if (initial.phase !== "ready" || !owner || initial.busy)
    throw new ApiError("stale_session");
  const current = () => {
    const now = session.snapshot();
    return (
      now.phase === "ready" &&
      !now.busy &&
      now.generation === initial.generation &&
      now.account?.id === owner
    );
  };
  return {
    async load() {
      return new EncryptedBookJournal(
        await openRows(),
        cipher,
        owner,
        current,
      ).load();
    },
    async save(
      value: Parameters<EncryptedBookJournal["save"]>[0],
      expectedId?: string,
    ) {
      return new EncryptedBookJournal(
        await openRows(),
        cipher,
        owner,
        current,
      ).save(value, expectedId);
    },
  };
}

// Same mature AES/SecureStore/SQLite primitives, separate slot and AAD domain.
export function nativeChapterPublicationJournal(session: Session) {
  const initial = session.snapshot(),
    owner = initial.account?.id;
  if (initial.phase !== "ready" || !owner || initial.busy)
    throw new ApiError("stale_session");
  const current = () => {
    const now = session.snapshot();
    return (
      now.phase === "ready" &&
      !now.busy &&
      now.generation === initial.generation &&
      now.account?.id === owner
    );
  };
  return {
    async load() {
      return new EncryptedChapterPublicationJournal(
        await openRows(),
        cipher,
        owner,
        current,
      ).load();
    },
    async save(
      value: Parameters<EncryptedChapterPublicationJournal["save"]>[0],
      expectedToken: string | null,
    ) {
      return new EncryptedChapterPublicationJournal(
        await openRows(),
        cipher,
        owner,
        current,
      ).save(value, expectedToken);
    },
  };
}

export function nativeNovelManagementJournal(session: Session) {
  const initial = session.snapshot(),
    owner = initial.account?.id;
  if (initial.phase !== "ready" || !owner || initial.busy)
    throw new ApiError("stale_session");
  const current = () => {
    const now = session.snapshot();
    return (
      now.phase === "ready" &&
      !now.busy &&
      now.generation === initial.generation &&
      now.account?.id === owner
    );
  };
  return {
    async load() {
      return new EncryptedNovelManagementJournal(
        await openRows(),
        cipher,
        owner,
        current,
      ).load();
    },
    async save(
      value: Parameters<EncryptedNovelManagementJournal["save"]>[0],
      expectedToken: string | null,
    ) {
      return new EncryptedNovelManagementJournal(
        await openRows(),
        cipher,
        owner,
        current,
      ).save(value, expectedToken);
    },
  };
}
