import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { Session } from "../auth/session";
import { DraftsApi } from "./api";
import { DraftSynchronizer } from "./sync";
import type { DraftTools } from "./workspace";
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

const toolsBySession = new WeakMap<Session, DraftTools>();
export function nativeDraftTools(session: Session): DraftTools {
  const existing = toolsBySession.get(session);
  if (existing) return existing;
  const api = new DraftsApi((path, options) => session.authorized(path, options));
  const identity = () => ({ owner: session.snapshot().drafts.owner, generation: session.snapshot().generation,
    online: !session.snapshot().busy && session.snapshot().drafts.phase === "online" });
  let synchronizer: Promise<DraftSynchronizer> | undefined;
  const tools: DraftTools = {
    local: nativeAuthorizedDrafts(session.snapshot), api, current: session.snapshot,
    uuid: Crypto.randomUUID,
    online: () => session.reconnectDrafts(),
    async sync(localId) {
      const value = identity();
      if (!value.owner || !value.online) return { state: "login-required" };
      if (!synchronizer) synchronizer = openNativeDraftRepository().then(repo => new DraftSynchronizer(repo, api, identity, Crypto.randomUUID))
        .catch(error => { synchronizer = undefined; throw error; });
      return (await synchronizer).sync(value.owner, localId);
    },
  };
  toolsBySession.set(session, tools);
  return tools;
}
