import { ApiError } from "../api/client.ts";
import { id } from "./model.ts";

export type DraftGrant = { owner: string; confirmed: boolean };
export type DraftAccess = {
  phase: "locked" | "confirmation" | "online" | "offline";
  owner: string | null;
};
export const lockedDraftAccess = (): DraftAccess => ({ phase: "locked", owner: null });
export interface DraftGrantVault {
  read(token: string): Promise<DraftGrant | null>;
  bind(token: string, owner: string): Promise<DraftGrant>;
  confirm(token: string, owner: string): Promise<DraftGrant>;
  lock(token: string): Promise<void>;
}
export interface LocalIdentityVault {
  read(token: string): Promise<string | null>;
  bind(token: string, owner: string): Promise<void>;
  lock(token: string): Promise<void>;
}
export interface SecureItem {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}
type Envelope = { format: 1; token: string; grant: DraftGrant | null; local_owner?: string | null };
const validToken = (value: unknown): boolean =>
  typeof value === "string" && /^tako_app_[0-9a-f]{64}$/.test(value);

// Credential and local grant share ONE secure item: a stale owner can never be
// paired with a newly stored token. Legacy raw tokens remain online-readable.
// No title, body, password or duplicate credential is written elsewhere.
export function createDraftSessionVault(item: SecureItem) {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action).catch((error) => {
      throw error instanceof ApiError ? error : new ApiError("storage");
    });
    queue = result.catch(() => undefined);
    return result;
  }
  async function decode(): Promise<Envelope | null> {
    const raw = await item.get();
    if (raw === null) return null;
    if (validToken(raw)) return { format: 1, token: raw, grant: null };
    try {
      const value = JSON.parse(raw);
      if (raw.length > 1024 || value?.format !== 1 || !validToken(value.token) ||
          Object.keys(value).some(key => !["format", "token", "grant", "local_owner"].includes(key)) ||
          !(value.local_owner === undefined || value.local_owner === null || (id(value.local_owner) && value.grant?.owner === value.local_owner)) ||
          !(value.grant === null || (id(value.grant?.owner) && typeof value.grant.confirmed === "boolean" &&
            Object.keys(value.grant).every(key => ["owner", "confirmed"].includes(key)))))
        throw new Error();
      return value as Envelope;
    } catch { throw new ApiError("storage"); }
  }
  async function matching(token: string) {
    const current = await decode();
    if (!current || current.token !== token) throw new ApiError("stale_session");
    return current;
  }
  async function write(current: Envelope) { await item.set(JSON.stringify(current)); }
  const drafts: DraftGrantVault = {
    read: (token) => serial(async () => (await matching(token)).grant),
    bind: (token, owner) => serial(async () => {
      if (!id(owner)) throw new ApiError("contract");
      const current = await matching(token);
      // Only an already confirmed identical token/owner retains offline access.
      const grant = current.grant?.owner === owner ? current.grant : { owner, confirmed: false };
      await write({ ...current, grant });
      return { ...grant };
    }),
    confirm: (token, owner) => serial(async () => {
      const current = await matching(token);
      if (!id(owner) || current.grant?.owner !== owner) throw new ApiError("stale_session");
      const grant = { owner, confirmed: true };
      await write({ ...current, grant });
      return grant;
    }),
    lock: (token) => serial(async () => {
      const current = await matching(token);
      await write({ ...current, grant: current.grant ? { ...current.grant, confirmed: false } : null });
    }),
  };
  const localIdentity: LocalIdentityVault = {
    read: (token) => serial(async () => (await matching(token)).local_owner ?? null),
    bind: (token, owner) => serial(async () => {
      if (!id(owner)) throw new ApiError("contract");
      const current=await matching(token);
      if(current.grant?.owner !== owner)throw new ApiError("stale_session");
      await write({...current,local_owner:owner});
    }),
    lock: (token) => serial(async () => {
      const current=await matching(token);
      await write({...current,local_owner:null});
    }),
  };
  return {
    localIdentity,
    get: () => serial(async () => (await decode())?.token ?? null),
    set: (token: string) => serial(async () => {
      if (!validToken(token)) throw new ApiError("contract");
      // Fresh login always needs explicit local-draft confirmation, including
      // switching back after another account. No former owner ledger is exposed.
      await write({ format: 1, token, grant: null, local_owner: null });
    }),
    remove: () => serial(() => item.remove()),
    drafts,
  };
}
