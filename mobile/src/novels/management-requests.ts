import { ApiError } from "../api/client.ts";
import { id, integer } from "../drafts/model.ts";
import type {
  NovelManagementApi,
  NovelVisibilityAction,
  SubmitNovelMetadata,
} from "./management-api.ts";
import type { ChapterPublicationApi } from "./chapters/publication-api.ts";
export type NovelCommand =
  | {
      kind: "visibility";
      book: string;
      chapter: string | null;
      input: NovelVisibilityAction;
    }
  | { kind: "metadata"; book: string; input: SubmitNovelMetadata }
  | {
      kind: "withdraw-chapter" | "withdraw-metadata";
      book: string;
      submission: string;
      mutation: string;
    };
export type NovelManagementRecord = {
  format: 1;
  token: string;
  command: NovelCommand;
  outcome: "pending" | "published" | "withdrawn" | "hidden" | "restored" | null;
  rejection: string | null;
};
export interface NovelManagementJournal {
  load(): Promise<NovelManagementRecord | null>;
  save(
    value: NovelManagementRecord | null,
    expectedToken: string | null,
  ): Promise<void>;
}
function shape(v: unknown, keys: string[]): v is Record<string, unknown> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k))
  );
}
export function checkedNovelCommand(command: unknown): NovelCommand {
  if (!command || typeof command !== "object") throw new ApiError("storage");
  const c = command as NovelCommand;
  if (!id(c.book)) throw new ApiError("storage");
  if (c.kind === "visibility") {
    if (
      !shape(c, ["kind", "book", "chapter", "input"]) ||
      !(c.chapter === null || id(c.chapter)) ||
      !shape(c.input, ["mutation_id", "expected_revision", "action"]) ||
      !id(c.input.mutation_id) ||
      !integer(c.input.expected_revision, 1) ||
      !["hide", "restore"].includes(c.input.action)
    )
      throw new ApiError("storage");
  } else if (c.kind === "metadata") {
    if (
      !shape(c, ["kind", "book", "input"]) ||
      !shape(c.input, [
        "mutation_id",
        "source_revision",
        "expected_revision",
        "rights_confirmed",
      ]) ||
      !id(c.input.mutation_id) ||
      !integer(c.input.source_revision, 1) ||
      !integer(c.input.expected_revision, 1) ||
      c.input.rights_confirmed !== true
    )
      throw new ApiError("storage");
  } else if (c.kind === "withdraw-chapter" || c.kind === "withdraw-metadata") {
    if (
      !shape(c, ["kind", "book", "submission", "mutation"]) ||
      !id(c.submission) ||
      !id(c.mutation)
    )
      throw new ApiError("storage");
  } else throw new ApiError("storage");
  return c;
}
const rejectionCodes = [
  "novel_state_conflict",
  "chapter_publication_conflict",
  "novel_revision_conflict",
  "source_revision_unavailable",
  "novel_restricted",
];
export function checkedNovelManagementRecord(
  v: unknown,
): NovelManagementRecord | null {
  if (v === null) return null;
  if (!shape(v, ["format", "token", "command", "outcome", "rejection"]))
    throw new ApiError("storage");
  const r = v as unknown as NovelManagementRecord;
  checkedNovelCommand(r.command);
  if (
    r.format !== 1 ||
    !id(r.token) ||
    !(
      r.outcome === null ||
      ["pending", "published", "withdrawn", "hidden", "restored"].includes(
        r.outcome,
      )
    ) ||
    !(r.rejection === null || rejectionCodes.includes(r.rejection)) ||
    (r.outcome && r.rejection)
  )
    throw new ApiError("storage");
  if (r.outcome) {
    const allowed =
      r.command.kind === "visibility"
        ? [r.command.input.action === "hide" ? "hidden" : "restored"]
        : r.command.kind === "metadata"
          ? ["pending", "published"]
          : ["withdrawn"];
    if (!allowed.includes(r.outcome)) throw new ApiError("storage");
  }
  return r;
}
export async function executeNovelCommand(
  management: NovelManagementApi,
  publication: ChapterPublicationApi,
  c: NovelCommand,
  confirm: boolean,
) {
  checkedNovelCommand(c);
  if (c.kind === "visibility") {
    await (confirm
      ? management.visibilityReceipt(c.book, c.chapter, c.input)
      : management.visibility(c.book, c.chapter, c.input));
    return c.input.action === "hide"
      ? ("hidden" as const)
      : ("restored" as const);
  }
  if (c.kind === "metadata")
    return (
      await (confirm
        ? management.confirmMetadata(c.book, c.input)
        : management.submitMetadata(c.book, c.input))
    ).state as "pending" | "published";
  if (c.kind === "withdraw-metadata") {
    if (confirm)
      await management.metadataReceipt(
        c.book,
        c.mutation,
        "withdraw_metadata",
        c.submission,
      );
    else await management.withdrawMetadata(c.book, c.submission, c.mutation);
    return "withdrawn" as const;
  }
  if (confirm)
    await publication.receipt({
      novel: c.book,
      mutation: c.mutation,
      operation: "withdraw",
      submission: c.submission,
    });
  else await publication.withdraw(c.book, c.submission, c.mutation);
  return "withdrawn" as const;
}
export class NovelOperations {
  private record: NovelManagementRecord | null = null;
  private loaded = false;
  private busy = false;
  private journal: NovelManagementJournal;
  private management: NovelManagementApi;
  private publication: ChapterPublicationApi;
  private current: () => boolean;
  private uuid: () => string;
  constructor(
    journal: NovelManagementJournal,
    management: NovelManagementApi,
    publication: ChapterPublicationApi,
    current: () => boolean,
    uuid: () => string,
  ) {
    this.journal = journal;
    this.management = management;
    this.publication = publication;
    this.current = current;
    this.uuid = uuid;
  }
  private guard() {
    if (!this.current()) throw new ApiError("stale_session");
  }
  private async once<T>(run: () => Promise<T>) {
    this.guard();
    if (this.busy) throw new ApiError("novel_request_pending");
    this.busy = true;
    try {
      return await run();
    } finally {
      this.busy = false;
    }
  }
  snapshot() {
    this.guard();
    return this.record
      ? (JSON.parse(JSON.stringify(this.record)) as NovelManagementRecord)
      : null;
  }
  private async save(r: NovelManagementRecord | null) {
    this.guard();
    checkedNovelManagementRecord(r);
    await this.journal.save(r, this.record?.token ?? null);
    this.guard();
    this.record = r;
  }
  async load() {
    return this.once(async () => {
      const r = await this.journal.load();
      this.guard();
      this.record = checkedNovelManagementRecord(r);
      this.loaded = true;
      return this.snapshot();
    });
  }
  async start(command: NovelCommand) {
    return this.once(async () => {
      if (!this.loaded || this.record)
        throw new ApiError("novel_request_pending");
      checkedNovelCommand(command);
      await this.save({
        format: 1,
        token: this.uuid(),
        command: JSON.parse(JSON.stringify(command)),
        outcome: null,
        rejection: null,
      });
      return this.send(false);
    });
  }
  private async send(confirm: boolean) {
    const r = this.record;
    if (!r || r.outcome || r.rejection) throw new ApiError("invalid_input");
    try {
      const outcome = await executeNovelCommand(
        this.management,
        this.publication,
        r.command,
        confirm,
      );
      this.guard();
      await this.save({ ...r, token: this.uuid(), outcome });
      return this.snapshot();
    } catch (e) {
      this.guard();
      if (
        !confirm &&
        e instanceof ApiError &&
        e.status === 409 &&
        rejectionCodes.includes(e.code)
      )
        await this.save({ ...r, token: this.uuid(), rejection: e.code });
      throw e;
    }
  }
  async confirm() {
    return this.once(() => this.send(true));
  }
  async retry() {
    return this.once(() => this.send(false));
  }
  async clear() {
    return this.once(async () => {
      if (
        !this.loaded ||
        !this.record ||
        (!this.record.outcome && !this.record.rejection)
      )
        throw new ApiError("novel_request_pending");
      await this.save(null);
    });
  }
}
