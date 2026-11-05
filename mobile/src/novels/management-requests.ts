import {
  NovelLifecycleApi,
  checkedLifecycleReceipt,
  type LifecycleReceipt,
} from "./lifecycle-api.ts";
import { ApiError } from "../api/client.ts";
import { id, integer } from "../drafts/model.ts";
import type {
  NovelManagementApi,
  NovelVisibilityAction,
  SubmitNovelMetadata,
} from "./management-api.ts";
import type { ChapterPublicationApi } from "./chapters/publication-api.ts";
export type LifecycleCommand =
  | { kind: "completion-check"; book: string; input: { mutation_id: string } }
  | {
      kind: "complete";
      book: string;
      input: {
        mutation_id: string;
        check_id: string;
        irreversible_confirmed: true;
      };
    }
  | {
      kind: "rectification-prepare";
      book: string;
      grant: string;
      input: {
        mutation_id: string;
        expected_revision: number;
        draft_id: string;
        source_revision: number;
      };
    }
  | {
      kind: "rectification-submit";
      book: string;
      grant: string;
      input: {
        mutation_id: string;
        expected_revision: number;
        preview_id: string;
        rights_confirmed: true;
      };
    }
  | {
      kind: "rectification-withdraw";
      book: string;
      grant: string;
      input: {
        mutation_id: string;
        expected_revision: number;
        reason: string;
        revoke_case: false;
      };
    };
export const isLifecycleCommand = (c: {
  kind: string;
}): c is LifecycleCommand =>
  [
    "completion-check",
    "complete",
    "rectification-prepare",
    "rectification-submit",
    "rectification-withdraw",
  ].includes(c.kind);
export function lifecycleExpected(c: LifecycleCommand): {
  operation: LifecycleReceipt["operation"];
  target?: string;
} {
  if (c.kind === "completion-check") return { operation: "completion_check" };
  if (c.kind === "complete")
    return { operation: "complete", target: c.input.check_id };
  if (c.kind === "rectification-prepare")
    return { operation: "rectification_prepare" };
  return {
    operation:
      c.kind === "rectification-submit"
        ? "rectification_submit"
        : "rectification_withdraw",
    target: c.grant,
  };
}
export type NovelCommand =
  | LifecycleCommand
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
  outcome:
    | "pending"
    | "published"
    | "withdrawn"
    | "hidden"
    | "restored"
    | "prepared"
    | "completed"
    | "submitted"
    | null;
  result?: LifecycleReceipt;
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
  if (isLifecycleCommand(c)) {
    if (
      !shape(
        c,
        c.kind.startsWith("rectification-")
          ? ["kind", "book", "grant", "input"]
          : ["kind", "book", "input"],
      ) ||
      !id(c.input.mutation_id)
    )
      throw new ApiError("storage");
    if (c.kind === "completion-check") {
      if (!shape(c.input, ["mutation_id"])) throw new ApiError("storage");
    } else if (c.kind === "complete") {
      if (
        !shape(c.input, [
          "mutation_id",
          "check_id",
          "irreversible_confirmed",
        ]) ||
        !id(c.input.check_id) ||
        c.input.irreversible_confirmed !== true
      )
        throw new ApiError("storage");
    } else {
      if (!id(c.grant) || !integer(c.input.expected_revision, 1))
        throw new ApiError("storage");
      if (c.kind === "rectification-prepare") {
        if (
          !shape(c.input, [
            "mutation_id",
            "expected_revision",
            "draft_id",
            "source_revision",
          ]) ||
          !id(c.input.draft_id) ||
          !integer(c.input.source_revision, 1)
        )
          throw new ApiError("storage");
      } else if (c.kind === "rectification-submit") {
        if (
          !shape(c.input, [
            "mutation_id",
            "expected_revision",
            "preview_id",
            "rights_confirmed",
          ]) ||
          !id(c.input.preview_id) ||
          c.input.rights_confirmed !== true
        )
          throw new ApiError("storage");
      } else if (
        !shape(c.input, [
          "mutation_id",
          "expected_revision",
          "reason",
          "revoke_case",
        ]) ||
        typeof c.input.reason !== "string" ||
        !c.input.reason.trim() ||
        Array.from(c.input.reason).length > 2000 ||
        c.input.revoke_case !== false
      )
        throw new ApiError("storage");
    }
  } else if (c.kind === "visibility") {
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
  "completion_check_expired",
  "chapter_preview_expired",
  "invalid_input",
];
export function checkedNovelManagementRecord(
  v: unknown,
): NovelManagementRecord | null {
  if (v === null) return null;
  if (
    !shape(v, [
      "format",
      "token",
      "command",
      "outcome",
      "rejection",
      ...(v && typeof v === "object" && Object.hasOwn(v, "result")
        ? ["result"]
        : []),
    ])
  )
    throw new ApiError("storage");
  const r = v as unknown as NovelManagementRecord;
  checkedNovelCommand(r.command);
  if (
    r.format !== 1 ||
    !id(r.token) ||
    !(
      r.outcome === null ||
      [
        "pending",
        "published",
        "withdrawn",
        "hidden",
        "restored",
        "prepared",
        "completed",
        "submitted",
      ].includes(r.outcome)
    ) ||
    !(r.rejection === null || rejectionCodes.includes(r.rejection)) ||
    (r.outcome && r.rejection)
  )
    throw new ApiError("storage");
  if (r.rejection === "invalid_input" && !isLifecycleCommand(r.command))
    throw new ApiError("storage");
  if (r.result !== undefined) {
    if (
      !isLifecycleCommand(r.command) ||
      !shape(r.result, [
        "mutation_id",
        "operation",
        "novel_id",
        "target_id",
        "state",
        "revision",
        "version",
        "accepted_at",
      ])
    )
      throw new ApiError("storage");
    const expected = lifecycleExpected(r.command);
    checkedLifecycleReceipt(
      r.result,
      r.command.book,
      r.command.input.mutation_id,
      expected.operation,
      expected.target,
    );
    if (
      "expected_revision" in r.command.input &&
      r.result.revision !==
        r.command.input.expected_revision +
          (r.command.kind === "rectification-prepare" ? 0 : 1)
    )
      throw new ApiError("storage");
    if (r.result.state !== r.outcome) throw new ApiError("storage");
  }
  if (isLifecycleCommand(r.command) && r.outcome && !r.result)
    throw new ApiError("storage");
  if (r.outcome) {
    const allowed = isLifecycleCommand(r.command)
      ? [
          r.command.kind === "completion-check" ||
          r.command.kind === "rectification-prepare"
            ? "prepared"
            : r.command.kind === "complete"
              ? "completed"
              : r.command.kind === "rectification-submit"
                ? "submitted"
                : "withdrawn",
        ]
      : r.command.kind === "visibility"
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
  lifecycle?: NovelLifecycleApi,
) {
  checkedNovelCommand(c);
  if (isLifecycleCommand(c)) {
    if (!lifecycle) throw new ApiError("invalid_input");
    const expect = lifecycleExpected(c);
    let result: LifecycleReceipt;
    if (confirm)
      result = await lifecycle.receipt(
        c.book,
        c.input.mutation_id,
        expect.operation,
        expect.target,
      );
    else if (c.kind === "completion-check")
      result = await lifecycle.prepareCompletion(c.book, c.input);
    else if (c.kind === "complete")
      result = await lifecycle.complete(c.book, c.input);
    else if (c.kind === "rectification-prepare")
      result = await lifecycle.prepare(c.book, c.grant, c.input);
    else if (c.kind === "rectification-submit")
      result = await lifecycle.submit(c.book, c.grant, c.input);
    else result = await lifecycle.withdraw(c.book, c.grant, c.input);
    if (
      c.kind.startsWith("rectification-") &&
      "expected_revision" in c.input &&
      result.revision !==
        c.input.expected_revision + (c.kind === "rectification-prepare" ? 0 : 1)
    )
      throw new ApiError("contract");
    return result;
  }
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
  private lifecycle?: NovelLifecycleApi;
  constructor(
    journal: NovelManagementJournal,
    management: NovelManagementApi,
    publication: ChapterPublicationApi,
    current: () => boolean,
    uuid: () => string,
    lifecycle?: NovelLifecycleApi,
  ) {
    this.journal = journal;
    this.management = management;
    this.publication = publication;
    this.current = current;
    this.uuid = uuid;
    this.lifecycle = lifecycle;
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
        this.lifecycle,
      );
      this.guard();
      await this.save({
        ...r,
        token: this.uuid(),
        outcome:
          typeof outcome === "string"
            ? outcome
            : (outcome.state as NovelManagementRecord["outcome"]),
        ...(typeof outcome === "object" ? { result: outcome } : {}),
      });
      return this.snapshot();
    } catch (e) {
      this.guard();
      if (
        !confirm &&
        e instanceof ApiError &&
        (([409, 410].includes(e.status) &&
          rejectionCodes.includes(e.code) &&
          e.code !== "invalid_input") ||
          (isLifecycleCommand(r.command) &&
            e.status === 400 &&
            e.code === "invalid_input"))
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
