import { ApiError } from "../api/client.ts";
import { UUID } from "../api/reader.ts";
import {
  PublicationsApi,
  checkedPreview,
  positive,
  publicationTags,
  type Preview,
  type Published,
  type Prepare,
  type Publish,
} from "../api/publications.ts";
export type Journal = {
  v: 1;
  account_id: string;
  draft_id: string;
  source_revision: number;
  request: Publish;
};
export type JournalStore = {
  get: () => Promise<string | null>;
  set: (value: string) => Promise<void>;
  remove: () => Promise<void>;
};
const definitive = (e: unknown) =>
  e instanceof ApiError &&
  e.status >= 400 &&
  e.status < 500 &&
  ![401, 403, 429].includes(e.status);
const writers = new Set<string>();
function parseJournal(raw: string, account: string): Journal {
  let data: Journal;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ApiError("recovery_invalid");
  }
  if (
    !data ||
    data.v !== 1 ||
    data.account_id !== account ||
    !UUID.test(data.draft_id) ||
    !positive(data.source_revision) ||
    !data.request ||
    !UUID.test(data.request.preview_id) ||
    !UUID.test(data.request.mutation_id) ||
    !Number.isSafeInteger(data.request.expected_version) ||
    data.request.expected_version < 0
  )
    throw new ApiError("recovery_invalid");
  return data;
}
export class PublicationFlow {
  preview: Preview | null = null;
  result: Published | null = null;
  pendingPrepare: Prepare | null = null;
  pendingPublish: Publish | null = null;
  busy = false;
  private api: PublicationsApi;
  private store: JournalStore;
  private account: string;
  private valid: () => boolean;
  private uuid: () => string;
  private clock: () => number;
  private blocked = true;
  constructor(
    api: PublicationsApi,
    store: JournalStore,
    account: string,
    valid: () => boolean,
    uuid: () => string,
    clock = Date.now,
  ) {
    this.api = api;
    this.store = store;
    this.account = account;
    this.valid = valid;
    this.uuid = uuid;
    this.clock = clock;
  }
  private check() {
    if (!this.valid()) throw new ApiError("stale_session");
  }
  private enter() {
    this.check();
    if (this.busy) throw new ApiError("operation_pending");
    this.busy = true;
  }
  async restore() {
    this.enter();
    this.blocked = true;
    try {
      const raw = await this.store.get();
      this.check();
      if (!raw) {
        this.blocked = false;
        return;
      }
      const data = parseJournal(raw, this.account);
      this.pendingPublish = Object.freeze({
        mutation_id: data.request.mutation_id,
        preview_id: data.request.preview_id,
        expected_version: data.request.expected_version,
      });
      const preview = checkedPreview(
        await this.api.read(data.request.preview_id),
        {
          id: data.request.preview_id,
          draft_id: data.draft_id,
          source_revision: data.source_revision,
        },
      );
      this.check();
      if (preview.expected_version !== data.request.expected_version)
        throw new ApiError("recovery_invalid");
      this.preview = preview;
      this.result = preview.published ?? null;
      this.blocked = false;
      // Restore reads only. Resubmission always requires another explicit press.
    } catch (e) {
      if (e instanceof ApiError && e.code === "preview_expired") {
        if (writers.has(this.account)) throw new ApiError("operation_pending");
        writers.add(this.account);
        try {
          const raw = await this.store.get();
          this.check();
          if (
            raw &&
            parseJournal(raw, this.account).request.mutation_id ===
              this.pendingPublish?.mutation_id
          )
            await this.store.remove();
          this.check();
          this.pendingPublish = null;
          this.blocked = false;
        } finally {
          writers.delete(this.account);
        }
      }
      throw e;
    } finally {
      this.busy = false;
    }
  }
  async prepare(
    draft: string,
    revision: number,
    introduction: string,
    tags: string[],
    rights: boolean,
  ) {
    this.enter();
    try {
      if (this.blocked || this.pendingPublish || this.preview)
        throw new ApiError("operation_pending");
      if (!this.pendingPrepare) {
        if (
          !UUID.test(draft) ||
          !positive(revision) ||
          !rights ||
          Array.from(introduction).length > 300 ||
          tags.length < 1 ||
          tags.length > 3 ||
          new Set(tags).size !== tags.length ||
          tags.some((x) => !publicationTags.includes(x))
        )
          throw new ApiError("invalid_input");
        this.pendingPrepare = Object.freeze({
          mutation_id: this.uuid(),
          draft_id: draft,
          source_revision: revision,
          introduction,
          tags: Object.freeze([...tags]) as unknown as Prepare["tags"],
          rights_confirmed: true,
        });
      }
      const preview = await this.api.prepare(this.pendingPrepare);
      this.check();
      this.preview = preview;
      this.pendingPrepare = null;
      this.result = preview.published ?? null;
    } catch (e) {
      if (definitive(e)) this.pendingPrepare = null;
      throw e;
    } finally {
      this.busy = false;
    }
  }
  async publish() {
    this.enter();
    if (writers.has(this.account)) {
      this.busy = false;
      throw new ApiError("operation_pending");
    }
    writers.add(this.account);
    let ownsJournal = false;
    try {
      if (this.blocked || !this.preview || this.result)
        throw new ApiError("operation_pending");
      let request = this.pendingPublish;
      if (!request) {
        if (Date.parse(this.preview.expires_at) <= this.clock())
          throw new ApiError("preview_expired", "", 410);
        request = Object.freeze({
          mutation_id: this.uuid(),
          preview_id: this.preview.id,
          expected_version: this.preview.expected_version,
        });
      }
      const journal: Journal = {
        v: 1,
        account_id: this.account,
        draft_id: this.preview.draft_id,
        source_revision: this.preview.source_revision,
        request,
      };
      const saved = await this.store.get();
      this.check();
      if (
        saved &&
        parseJournal(saved, this.account).request.mutation_id !==
          request.mutation_id
      )
        throw new ApiError("another_publication_pending");
      this.pendingPublish = request;
      try {
        await this.store.set(JSON.stringify(journal));
      } catch {
        throw new ApiError("storage");
      }
      ownsJournal = true;
      this.check();
      const result = await this.api.publish(this.pendingPublish);
      this.check();
      this.result = result;
      // Keep the tiny receipt pointer until explicit acknowledgement; no text stored.
    } catch (e) {
      if (definitive(e)) {
        if (ownsJournal) {
          await this.store.remove();
          this.check();
        }
        this.pendingPublish = null;
      }
      throw e;
    } finally {
      writers.delete(this.account);
      this.busy = false;
    }
  }
  async reset() {
    this.enter();
    if (writers.has(this.account)) {
      this.busy = false;
      throw new ApiError("operation_pending");
    }
    writers.add(this.account);
    try {
      if (this.pendingPrepare || (this.pendingPublish && !this.result))
        throw new ApiError("operation_pending");
      const raw = await this.store.get();
      this.check();
      if (
        raw &&
        parseJournal(raw, this.account).request.mutation_id !==
          this.pendingPublish?.mutation_id
      )
        throw new ApiError("operation_pending");
      await this.store.remove();
      this.check();
      this.preview = null;
      this.result = null;
      this.pendingPublish = null;
      this.blocked = false;
    } finally {
      writers.delete(this.account);
      this.busy = false;
    }
  }
}
