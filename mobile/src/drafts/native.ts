import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { DraftError } from "./model";
import { DraftRepository, type DraftCipher } from "./storage";
import { SqliteCipherRows } from "./sqlite";
import { AuthorizedDrafts, type LocalIdentity } from "./authorized";

const pendingKeys = new Map<string, Promise<string>>();
async function key(owner: string, allowNew: boolean) {
  const name = "tako.test.draft-key.v1." + owner;
  const existing = pendingKeys.get(name);
  if (existing) return existing;
  const operation = (async () => {
    const stored = await SecureStore.getItemAsync(name);
    if (stored) return stored;
    if (!allowNew) throw new DraftError("unreadable");
    const generated = await Crypto.AESEncryptionKey.generate(256);
    const encoded = await generated.encoded("hex");
    await SecureStore.setItemAsync(name, encoded, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    return encoded;
  })();
  pendingKeys.set(name, operation);
  try { return await operation; } finally { pendingKeys.delete(name); }
}
export const nativeDraftCipher: DraftCipher = {
  async seal(owner, context, plaintext, allowNewKey) {
    const aes = await Crypto.AESEncryptionKey.import(await key(owner, allowNewKey), "hex");
    const sealed = await Crypto.aesEncryptAsync(new TextEncoder().encode(plaintext), aes,
      { additionalData: new TextEncoder().encode(context), tagLength: 16 });
    return sealed.combined("base64");
  },
  async open(owner, context, ciphertext) {
    const aes = await Crypto.AESEncryptionKey.import(await key(owner, false), "hex");
    const bytes = await Crypto.aesDecryptAsync(Crypto.AESSealedData.fromCombined(ciphertext), aes,
      { additionalData: new TextEncoder().encode(context), output: "bytes" });
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  },
};
// Private app database; never use a shared/cache directory. Not opened until drafting is connected.
let repository: Promise<DraftRepository> | undefined;
function openNativeDraftRepository(): Promise<DraftRepository> {
  if (!repository) {
    repository = (async () => {
      const db = await SQLite.openDatabaseAsync("tako-test-private-drafts-v1.db");
      try {
        const rows = new SqliteCipherRows(db);
        await rows.initialize();
        return new DraftRepository(rows, nativeDraftCipher);
      } catch {
        await db.closeAsync().catch(() => undefined);
        throw new DraftError("storage");
      }
    })().catch((e) => { repository = undefined; throw e; });
  }
  return repository;
}

export function nativeAuthorizedDrafts(current: () => LocalIdentity) {
  return new AuthorizedDrafts(openNativeDraftRepository, current);
}
