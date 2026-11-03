import { ApiError } from "../api/client.ts";
import type {
  AuthorAppealsApi,
  AppealInput,
  CasePage,
  CaseDetail,
} from "../api/author-appeals.ts";
type State = {
  page: CasePage;
  id: number;
  detail: CaseDetail | null;
  busy: boolean;
  loaded: boolean;
  error: unknown;
  prepared: AppealInput | null;
  pending: AppealInput | null;
  confirmed: boolean;
  needsRead: boolean;
};
export class AuthorAppeals {
  private state: State = {
    page: { items: [], next: 0 },
    id: 0,
    detail: null,
    busy: false,
    loaded: false,
    error: null,
    prepared: null,
    pending: null,
    confirmed: false,
    needsRead: true,
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private request?: AbortController;
  private writing = false;
  private api: AuthorAppealsApi;
  private valid: () => boolean;
  private uuid: () => string;
  constructor(api: AuthorAppealsApi, valid: () => boolean, uuid: () => string) {
    this.api = api;
    this.valid = valid;
    this.uuid = uuid;
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(change: Partial<State>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((fn) => fn());
  }
  cancelRead() {
    this.epoch++;
    this.request?.abort();
  }
  suspend() {
    if (!this.writing) {
      this.cancelRead();
      this.update({ busy: false });
    }
  }
  dispose() {
    this.cancelRead();
    this.update({ pending: null, prepared: null });
  }
  private check() {
    if (!this.valid()) throw new ApiError("stale_session");
  }
  async open(id: number) {
    this.check();
    if (this.state.pending || this.state.prepared || this.state.busy)
      throw new ApiError("operation_pending");
    this.cancelRead();
    this.update({
      id,
      detail: null,
      loaded: false,
      confirmed: false,
      needsRead: true,
      error: null,
    });
    await this.read();
  }
  async read(more = false) {
    if (!this.valid() || this.state.busy) return;
    this.cancelRead();
    const epoch = this.epoch,
      request = (this.request = new AbortController());
    const current = () =>
      this.valid() && epoch === this.epoch && !request.signal.aborted;
    const { id, page, detail } = this.state;
    const before = more ? ((id ? detail?.appeals.next : page.next) ?? 0) : 0;
    if (more && !before) return;
    this.update({
      busy: true,
      error: null,
      ...(!more && id ? { needsRead: true } : {}),
    });
    try {
      if (id) {
        const result = await this.api.detail(id, before, request.signal);
        if (!current()) return;
        if (more && detail) {
          // A changed case needs a fresh first page before another application.
          const changed =
            result.case.revision !== detail.case.revision ||
            result.case.state !== detail.case.state;
          result.appeals.items = [
            ...detail.appeals.items,
            ...result.appeals.items.filter(
              (x) => !detail.appeals.items.some((y) => y.id === x.id),
            ),
          ];
          this.update({
            detail: result,
            needsRead: changed || this.state.needsRead,
          });
        } else this.update({ detail: result, needsRead: false });
      } else {
        const result = await this.api.list(before, request.signal);
        if (!current()) return;
        this.update({
          page: {
            items: more
              ? [
                  ...page.items,
                  ...result.items.filter(
                    (x) => !page.items.some((y) => y.id === x.id),
                  ),
                ]
              : result.items,
            next: result.next,
          },
        });
      }
      this.update({ loaded: true });
    } catch (error) {
      if (current()) this.update({ error });
    } finally {
      if (current()) this.update({ busy: false });
    }
  }
  prepare(reason: string) {
    this.check();
    const { detail, busy, pending, prepared, needsRead } = this.state;
    if (
      busy ||
      pending ||
      prepared ||
      needsRead ||
      !detail ||
      detail.case.state !== "active" ||
      detail.appeals.items.some((x) => x.state === "pending")
    )
      throw new ApiError("operation_pending");
    reason = reason.trim();
    if (!reason || [...reason].length > 2000 || /\p{Cs}/u.test(reason))
      throw new ApiError("invalid_appeal_reason");
    this.update({
      confirmed: false,
      prepared: Object.freeze({
        mutation_id: this.uuid(),
        expected_revision: detail.case.revision,
        decision: "appeal",
        reason,
      }),
      error: null,
    });
  }
  cancelPreparation() {
    if (!this.state.busy) this.update({ prepared: null });
  }
  async send() {
    this.check();
    const input = this.state.pending ?? this.state.prepared;
    if (this.state.busy || !input) throw new ApiError("operation_pending");
    this.cancelRead();
    const epoch = this.epoch,
      id = this.state.id;
    const current = () => this.valid() && epoch === this.epoch;
    this.update({
      pending: input,
      prepared: null,
      busy: true,
      error: null,
      needsRead: true,
    });
    this.writing = true;
    let success = false;
    try {
      await this.api.appeal(id, input);
      if (!current()) return;
      this.update({ pending: null, confirmed: true });
      success = true;
    } catch (error) {
      if (current())
        this.update({
          error,
          ...(error instanceof ApiError &&
          [400, 401, 403, 404, 409].includes(error.status)
            ? { pending: null }
            : {}),
        });
    } finally {
      this.writing = false;
      if (current()) this.update({ busy: false });
    }
    if (success && current()) await this.read();
  }
}
