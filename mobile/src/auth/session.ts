import { ApiError } from "../api/client.ts";
import { UUID } from "../api/reader.ts";
import type { components } from "../api/contract";
import { lockedDraftAccess, type DraftAccess, type DraftGrantVault } from "../drafts/access.ts";
export type Account = components["schemas"]["Account"];
export type Snapshot = {
  phase: "loading" | "guest" | "ready" | "offline";
  account: Account | null;
  busy: boolean;
  error: unknown;
  generation: number;
  drafts: DraftAccess;
};
export type Transport = <T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    token?: string;
    signal?: AbortSignal;
  },
) => Promise<T>;
export type Vault = {
  drafts?: DraftGrantVault;
  get: () => Promise<string | null>;
  set: (token: string) => Promise<void>;
  remove: () => Promise<void>;
};
const validToken = (v: unknown): v is string =>
  typeof v === "string" && /^tako_app_[0-9a-f]{64}$/.test(v);
const validAccount = (v: unknown): v is Account =>
  !!v &&
  typeof v === "object" &&
  "id" in v &&
  typeof v.id === "string" &&
  UUID.test(v.id) &&
  "nickname" in v &&
  typeof v.nickname === "string";
export class Session {
  private vault: Vault;
  private transport: Transport;
  private readPendingDrafts?: () => Promise<number>;
  private token = "";
  private epoch = 0;
  private unsafeStorage = false;
  private listeners = new Set<() => void>();
  private state: Snapshot = {
    phase: "loading",
    account: null,
    busy: false,
    error: null,
    generation: 0,
    drafts: lockedDraftAccess(),
  };
  constructor(vault: Vault, transport: Transport, readPendingDrafts?: () => Promise<number>) {
    this.vault = vault;
    this.transport = transport;
    this.readPendingDrafts = readPendingDrafts;
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  async restore() {
    if (this.state.busy) return;
    const epoch = ++this.epoch;
    this.update({
      phase: "loading",
      account: null,
      busy: true,
      error: null,
      generation: epoch,
      drafts: lockedDraftAccess(),
    });
    let localGrant: Awaited<ReturnType<DraftGrantVault["read"]>> = null;
    try {
      const token = await this.vault.get();
      if (epoch !== this.epoch) return;
      if (!token) {
        this.token = "";
        this.update({ phase: "guest" });
        return;
      }
      if (!validToken(token)) {
        this.token = "";
        await this.vault.remove();
        this.update({ phase: "guest" });
        return;
      }
      this.token = token;
      if (!this.unsafeStorage) localGrant = await this.vault.drafts?.read(token) ?? null;
      if (epoch !== this.epoch) return;
      const account = await this.transport<Account>("/me", { token });
      if (epoch !== this.epoch) return;
      if (!validAccount(account)) throw new ApiError("contract");
      const grant = await this.vault.drafts?.bind(token, account.id);
      if (epoch !== this.epoch) return;
      this.unsafeStorage = false;
      this.update({ phase: "ready", account, drafts: grant ? { owner: account.id, phase: grant.confirmed ? "online" : "confirmation" } : lockedDraftAccess() });
    } catch (e) {
      if (epoch !== this.epoch) return;
      if (e instanceof ApiError && e.status === 401) {
        // restore is a fire-and-observe API used by existing screens. Persist
        // errors remain in snapshot.error; do not introduce an unhandled reject.
        await this.forget().catch(() => undefined);
      } else {
        const network = e instanceof ApiError && (e.code === "network" || e.status >= 500);
        this.update({ phase: "offline", error: e, drafts:
          network && localGrant?.confirmed && !this.unsafeStorage
            ? { owner: localGrant.owner, phase: "offline" } : lockedDraftAccess() });
      }
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  async signIn(mode: "login" | "register", email: string, password: string) {
    if (this.state.busy) throw new ApiError("session_busy");
    if (this.token) throw new ApiError("stale_session");
    const epoch = ++this.epoch;
    this.update({ busy: true, error: null });
    try {
      const result = await this.transport<{
        account: Account;
        access_token: string;
        token_type: string;
        expires_in: number;
      }>(`/app/auth/${mode}`, {
        method: "POST",
        body: { email: email.trim(), password },
      });
      if (
        !validAccount(result.account) ||
        !validToken(result.access_token) ||
        result.token_type !== "Bearer" ||
        result.expires_in !== 604800
      )
        throw new ApiError("contract");
      try {
        await this.vault.set(result.access_token);
        await this.vault.drafts?.bind(result.access_token, result.account.id);
      } catch {
        await this.transport("/app/auth/logout", {
          method: "POST",
          body: {},
          token: result.access_token,
        }).catch(() => undefined);
        this.unsafeStorage = true;
        await this.vault.remove().catch(() => undefined);
        this.update({ drafts: lockedDraftAccess() });
        throw new ApiError("storage");
      }
      if (epoch !== this.epoch) return;
      this.unsafeStorage = false;
      this.token = result.access_token;
      this.update({
        phase: "ready",
        account: result.account,
        generation: epoch,
        drafts: this.vault.drafts ? { owner: result.account.id, phase: "confirmation" } : lockedDraftAccess(),
      });
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  async authorized<T>(
    path: string,
    options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (this.state.phase !== "ready" || !this.token)
      throw new ApiError("authentication_required", "", 401);
    if (this.state.busy) throw new ApiError("session_busy");
    const epoch = this.epoch,
      token = this.token;
    try {
      const result = await this.transport<T>(path, { ...options, token });
      if (epoch !== this.epoch) throw new ApiError("stale_session");
      return result;
    } catch (e) {
      if (epoch === this.epoch && e instanceof ApiError && e.status === 401)
        await this.forget();
      throw e;
    }
  }
  async confirmDraftAccess() {
    if (!this.vault.drafts || this.state.phase !== "ready" || !this.state.account)
      throw new ApiError("authentication_required", "", 401);
    if (this.state.busy) throw new ApiError("session_busy");
    const epoch = this.epoch, token = this.token, owner = this.state.account.id;
    this.update({ busy: true, drafts: lockedDraftAccess() });
    try {
      const account = await this.transport<Account>("/me", { token });
      if (epoch !== this.epoch) throw new ApiError("stale_session");
      if (!validAccount(account) || account.id !== owner) throw new ApiError("contract");
      await this.vault.drafts.confirm(token, owner);
      if (epoch !== this.epoch) throw new ApiError("stale_session");
      this.update({ drafts: { phase: "online", owner }, error: null });
    } catch (error) {
      if (epoch === this.epoch) {
        if (error instanceof ApiError && error.status === 401) await this.forget();
        else this.update({ error, drafts: lockedDraftAccess() });
      }
      throw error;
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  // The app supplies a protected reader; ordinary server-only consumers do not
  // import the native database just to render an account page.
  async pendingDraftCount() {
    const owner = this.state.drafts.owner, epoch = this.epoch;
    if (!this.readPendingDrafts || !owner || this.state.busy || !["online", "offline"].includes(this.state.drafts.phase)) return 0;
    const count = await this.readPendingDrafts();
    if (epoch !== this.epoch || owner !== this.state.drafts.owner || this.state.busy) throw new ApiError("stale_session");
    if (!Number.isSafeInteger(count) || count < 0) throw new ApiError("storage");
    return count;
  }
  // Reconnect already-authorized drafts without changing editor generation.
  // This cannot grant access to a locked account.
  async reconnectDrafts() {
    if (this.state.busy || !this.token || !this.state.drafts.owner ||
        !["online", "offline"].includes(this.state.drafts.phase)) return false;
    const epoch = this.epoch, token = this.token, owner = this.state.drafts.owner;
    const current = () => epoch === this.epoch && token === this.token &&
      this.state.drafts.owner === owner && !this.state.busy;
    try {
      const account = await this.transport<Account>("/me", { token });
      if (!current()) return false;
      if (!validAccount(account) || account.id !== owner) throw new ApiError("contract");
      const grant = await this.vault.drafts?.bind(token, owner);
      if (!current()) return false;
      if (!grant?.confirmed) return false;
      this.update({ phase: "ready", account, error: null, drafts: { phase: "online", owner } });
      return true;
    } catch (error) {
      if (!current()) return false;
      if (error instanceof ApiError && error.status === 401) await this.forget();
      else this.update({ error });
      return false;
    }
  }
  async setNickname(nickname: string) {
    const epoch = this.epoch;
    const account = await this.authorized<Account>("/me", {
      method: "PATCH",
      body: { nickname: nickname.trim() },
    });
    if (epoch !== this.epoch) throw new ApiError("stale_session");
    if (!validAccount(account)) throw new ApiError("contract");
    this.update({ account });
  }
  async logout() {
    if (this.state.busy) throw new ApiError("session_busy");
    if (!this.token) return;
    const epoch = this.epoch,
      token = this.token;
    this.update({ busy: true, error: null, drafts: lockedDraftAccess() });
    try {
      await this.vault.drafts?.lock(token);
      if (epoch !== this.epoch) return;
      await this.transport("/app/auth/logout", {
        method: "POST",
        body: {},
        token,
      });
      if (epoch !== this.epoch) return;
      await this.forget();
    } catch (e) {
      if (epoch !== this.epoch) {
        if (e instanceof ApiError && e.code === "storage") throw e;
        return;
      }
      if (e instanceof ApiError && e.status === 401) {
        await this.forget();
        return;
      }
      if (e instanceof ApiError && e.code === "storage") this.unsafeStorage = true;
      this.update({ error: e, drafts: lockedDraftAccess() });
      throw e;
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  private async forget() {
    const token = this.token;
    this.token = "";
    this.epoch++;
    const epoch = this.epoch;
    this.update({
      phase: "guest",
      account: null,
      generation: this.epoch,
      busy: true,
      drafts: lockedDraftAccess(),
    });
    try {
      // Best-effort lock plus credential deletion: either persisted outcome
      // prevents offline access. Neither failure is reported as safe logout.
      if (this.vault.drafts && token) {
        await this.vault.drafts.lock(token).catch(() => undefined);
      }
      await this.vault.remove();
      this.unsafeStorage = false;
    } catch {
      this.unsafeStorage = true;
      const error = new ApiError("storage");
      this.update({ error });
      throw error;
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
}
