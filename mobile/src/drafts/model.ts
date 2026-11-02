import type { components } from "../api/contract";
import { UUID } from "../api/reader.ts";

export type ServerDraft = components["schemas"]["Draft"];
export type DraftAck = components["schemas"]["WriteResult"];
export type DraftPending = {
  kind: "create" | "save" | "recover";
  seq: number;
  body: { mutation_id: string; title: string; content: string; draft_id?: string; base_revision?: number };
};
export type LocalDraft = {
  format: 1;
  owner: string;
  id: string;
  seq: number;
  serverId: string | null;
  baseRevision: number;
  title: string;
  content: string;
  dirty: boolean;
  savedAt: string | null;
  recoveredFrom: string | null;
  pending: DraftPending | null;
};
export class DraftError extends Error {
  code: "storage" | "unreadable" | "local_conflict" | "invalid_input" | "account_mismatch";
  constructor(code: DraftError["code"]) {
    super(code);
    this.code = code;
  }
}
export const id = (v: unknown): v is string => typeof v === "string" && UUID.test(v) && v !== "00000000-0000-0000-0000-000000000000";
export const integer = (v: unknown, minimum = 0): v is number => Number.isSafeInteger(v) && Number(v) >= minimum;
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
export const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
export function text(title: unknown, content: unknown): title is string {
  return typeof title === "string" && Array.from(title).length <= 200 && typeof content === "string" &&
    new TextEncoder().encode(content).byteLength <= 1_048_576;
}
export function checkedLocal(v: unknown, owner: string, localId: string): LocalDraft {
  if (!object(v) || v.format !== 1 || v.owner !== owner || v.id !== localId || !id(owner) || !id(localId) ||
      !integer(v.seq, 1) || !integer(v.baseRevision) || !text(v.title, v.content) || typeof v.dirty !== "boolean" ||
      !(v.savedAt === null || date(v.savedAt)) || !(v.recoveredFrom === null || id(v.recoveredFrom)) ||
      !(v.serverId === null ? v.baseRevision === 0 : id(v.serverId) && v.baseRevision > 0)) throw new DraftError("unreadable");
  if (v.pending !== null) {
    const p = v.pending;
    if (!object(p) || !["create", "save", "recover"].includes(String(p.kind)) || !integer(p.seq, 1) || p.seq > v.seq ||
        !object(p.body) || !id(p.body.mutation_id) || !text(p.body.title, p.body.content)) throw new DraftError("unreadable");
    if (p.kind === "create" ? v.serverId !== null || p.body.draft_id !== undefined || p.body.base_revision !== undefined :
      p.body.draft_id !== v.serverId || !integer(p.body.base_revision, 1)) throw new DraftError("unreadable");
  }
  return v as LocalDraft;
}
