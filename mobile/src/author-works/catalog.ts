import { ApiError } from "../api/client.ts";
import type { AuthorWorksApi, CatalogPage } from "../api/author-works.ts";

export type CatalogQuery = {
  q: string;
  visibility: "all" | "shown" | "hidden";
  restriction: "all" | "restricted" | "unrestricted";
};
export const emptyCatalogQuery = (): CatalogQuery => ({
  q: "",
  visibility: "all",
  restriction: "all",
});
export function normalizeCatalogQuery(query: CatalogQuery): CatalogQuery {
  const q = query.q.trim().toLowerCase();
  if (
    /[\p{Cc}\p{Cs}]/u.test(query.q) ||
    [...q].length > 64 ||
    !["all", "shown", "hidden"].includes(query.visibility) ||
    !["all", "restricted", "unrestricted"].includes(query.restriction)
  )
    throw new ApiError("invalid_catalog_query");
  return { ...query, q };
}
export const sameCatalogQuery = (a: CatalogQuery, b: CatalogQuery) =>
  a.q === b.q &&
  a.visibility === b.visibility &&
  a.restriction === b.restriction;
type State = {
  query: CatalogQuery;
  page: CatalogPage;
  busy: boolean;
  loaded: boolean;
  error: unknown;
  refreshed: boolean;
};

// A live catalog, scoped to one session. Superseded reads never own the view.
export class AuthorCatalog {
  private state: State = {
    query: emptyCatalogQuery(),
    page: { items: [], next_cursor: "" },
    busy: false,
    loaded: false,
    error: null,
    refreshed: false,
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private request?: AbortController;
  private cursors = new Set<string>();
  private api: Pick<AuthorWorksApi, "catalog">;
  private valid: () => boolean;
  constructor(api: Pick<AuthorWorksApi, "catalog">, valid: () => boolean) {
    this.api = api;
    this.valid = valid;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<State>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((fn) => fn());
  }
  cancel() {
    this.epoch++;
    this.request?.abort();
    this.update({ busy: false });
  }
  async apply(input: CatalogQuery) {
    let query: CatalogQuery;
    try {
      query = normalizeCatalogQuery(input);
    } catch (error) {
      this.update({ error });
      return;
    }
    this.cancel();
    this.cursors.clear();
    this.update({
      query,
      page: { items: [], next_cursor: "" },
      loaded: false,
      refreshed: false,
    });
    await this.read("");
  }
  async refresh() {
    this.cancel();
    this.cursors.clear();
    // Remove stale statuses before reading; failed refresh cannot masquerade as current.
    this.update({
      page: { items: [], next_cursor: "" },
      loaded: false,
      refreshed: false,
    });
    await this.read("", true);
  }
  async more() {
    if (this.state.busy || !this.state.page.next_cursor) return;
    await this.read(this.state.page.next_cursor);
  }
  private async read(cursor: string, refreshed = false) {
    if (!this.valid()) return;
    const epoch = ++this.epoch,
      request = (this.request = new AbortController());
    const current = () =>
      epoch === this.epoch && !request.signal.aborted && this.valid();
    this.update({ busy: true, error: null });
    try {
      const page = await this.api.catalog(
        this.state.query,
        cursor,
        request.signal,
      );
      if (!current()) return;
      if (
        page.next_cursor &&
        (page.next_cursor === cursor || this.cursors.has(page.next_cursor))
      )
        throw new ApiError("contract");
      if (cursor) this.cursors.add(cursor);
      const old = cursor ? this.state.page.items : [];
      this.update({
        page: {
          items: [
            ...old,
            ...page.items.filter((item) => !old.some((x) => x.id === item.id)),
          ],
          next_cursor: page.next_cursor,
        },
        loaded: true,
        refreshed,
      });
    } catch (error) {
      if (current()) this.update({ error });
    } finally {
      if (current()) this.update({ busy: false });
    }
  }
}
