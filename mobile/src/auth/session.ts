import { ApiError } from "../api/client.ts";
import { UUID } from "../api/reader.ts";
import type { components } from "../api/contract";
export type Account = components["schemas"]["Account"];
export type Snapshot = {
  phase: "loading" | "guest" | "ready" | "offline";
  account: Account | null;
  busy: boolean;
  error: unknown;
  generation: number;
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
  private token = "";
  private epoch = 0;
  private listeners = new Set<() => void>();
  private state: Snapshot = {
    phase: "loading",
    account: null,
    busy: false,
    error: null,
    generation: 0,
  };
  constructor(vault: Vault, transport: Transport) {
    this.vault = vault;
    this.transport = transport;
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
    });
    try {
      const token = await this.vault.get();
      if (epoch !== this.epoch) return;
      if (!token) {
        this.token = "";
        this.update({ phase: "guest" });
        return;
      }
      if (!validToken(token)) {
        await this.vault.remove();
        this.update({ phase: "guest" });
        return;
      }
      this.token = token;
      const account = await this.transport<Account>("/me", { token });
      if (epoch !== this.epoch) return;
      if (!validAccount(account)) throw new ApiError("contract");
      this.update({ phase: "ready", account });
    } catch (e) {
      if (epoch !== this.epoch) return;
      if (e instanceof ApiError && e.status === 401) {
        await this.forget();
      } else this.update({ phase: "offline", error: e });
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
      } catch {
        await this.transport("/app/auth/logout", {
          method: "POST",
          body: {},
          token: result.access_token,
        }).catch(() => undefined);
        throw new ApiError("storage");
      }
      if (epoch !== this.epoch) return;
      this.token = result.access_token;
      this.update({
        phase: "ready",
        account: result.account,
        generation: epoch,
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
    this.update({ busy: true, error: null });
    try {
      await this.transport("/app/auth/logout", {
        method: "POST",
        body: {},
        token,
      });
      if (epoch !== this.epoch) return;
      await this.forget();
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.update({ error: e });
      throw e;
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  private async forget() {
    this.token = "";
    this.epoch++;
    const epoch = this.epoch;
    this.update({
      phase: "guest",
      account: null,
      generation: this.epoch,
      busy: true,
    });
    try {
      await this.vault.remove();
    } catch {
      this.update({ error: new ApiError("storage") });
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
}
