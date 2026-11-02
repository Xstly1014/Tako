import { mergeWorks, ReaderError, type WorkCard } from "../api/reader.ts";
import { searchQuery, searchWorks, type SearchPage } from "../api/search.ts";
export type SearchState = {
  input: string;
  query: string;
  items: WorkCard[];
  cursor: string;
  searchId: number;
  loading: boolean;
  moreLoading: boolean;
  error: unknown;
  moreError: unknown;
  inputError: string;
};
const initial = (): SearchState => ({
  input: "",
  query: "",
  items: [],
  cursor: "",
  searchId: 0,
  loading: false,
  moreLoading: false,
  error: null,
  moreError: null,
  inputError: "",
});
export class SearchFlow {
  private state = initial();
  private epoch = 0;
  private active: AbortController | null = null;
  private listeners = new Set<() => void>();
  private load: typeof searchWorks;
  constructor(load: typeof searchWorks = searchWorks) {
    this.load = load;
  }
  snapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<SearchState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  input(value: string) {
    if (!value) {
      this.clear();
      return;
    }
    this.update({ input: value, inputError: "" });
  }
  clear() {
    this.epoch++;
    this.active?.abort();
    this.active = null;
    this.update({ ...initial(), searchId: this.epoch });
  }
  dispose() {
    this.epoch++;
    this.active?.abort();
    this.active = null;
    this.update({ loading: false, moreLoading: false });
  }
  canMore() {
    return (
      !!this.state.cursor &&
      !this.state.loading &&
      !this.state.moreLoading &&
      searchQuery(this.state.input) === this.state.query
    );
  }
  async submit() {
    const q = searchQuery(this.state.input);
    if (q === null) {
      this.update({
        inputError: "请输入 1～64 字的关键词，不含换行或控制字符。",
      });
      return;
    }
    if (this.state.loading && this.state.query === q) return;
    const epoch = ++this.epoch,
      controller = new AbortController();
    this.active?.abort();
    this.active = controller;
    this.update({
      query: q,
      items: [],
      cursor: "",
      searchId: epoch,
      loading: true,
      moreLoading: false,
      error: null,
      moreError: null,
      inputError: "",
    });
    try {
      const page = await this.load(q, "", controller.signal);
      if (epoch === this.epoch)
        this.update({
          items: mergeWorks([], page.items),
          cursor: page.next_cursor,
        });
    } catch (error) {
      if (epoch === this.epoch) this.update({ error });
    } finally {
      if (epoch === this.epoch) {
        this.active = null;
        this.update({ loading: false });
      }
    }
  }
  async more() {
    if (!this.canMore()) return;
    const epoch = this.epoch,
      query = this.state.query,
      cursor = this.state.cursor,
      controller = new AbortController();
    this.active = controller;
    this.update({ moreLoading: true, moreError: null });
    try {
      const page: SearchPage = await this.load(
        query,
        cursor,
        controller.signal,
      );
      if (epoch !== this.epoch) return;
      if (page.next_cursor === cursor) throw new ReaderError("contract");
      this.update({
        items: mergeWorks(this.state.items, page.items),
        cursor: page.next_cursor,
      });
    } catch (error) {
      if (epoch === this.epoch) this.update({ moreError: error });
    } finally {
      if (epoch === this.epoch) {
        this.active = null;
        this.update({ moreLoading: false });
      }
    }
  }
}
