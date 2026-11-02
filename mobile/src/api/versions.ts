import type { components } from "./contract";
import { isWork, read, ReaderError, UUID } from "./reader.ts";

export type PublicTimeline = components["schemas"]["PublicTimeline"];
export type VersionEntry = components["schemas"]["PublicVersionEntry"];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const entry = (v: unknown): v is VersionEntry => record(v) && integer(v.version, 1) &&
  date(v.published_at) && typeof v.is_current === "boolean" && typeof v.readable === "boolean";
export const isTimeline = (v: unknown): v is PublicTimeline => record(v) &&
  typeof v.history_open === "boolean" && Array.isArray(v.versions) && v.versions.length <= 20 &&
  v.versions.every(entry) && new Set(v.versions.map((x) => x.version)).size === v.versions.length &&
  Array.isArray(v.events) && v.events.length <= 20 && v.events.every((e) => record(e) &&
    integer(e.sequence, 1) && integer(e.version, 1) && date(e.created_at) &&
    ["hidden", "restored", "display_changed", "history_opened", "history_closed"].includes(String(e.kind))) &&
  integer(v.next_version_before) && integer(v.next_event_before);

export async function timeline(id: string, before = 0, signal?: AbortSignal) {
  if (!UUID.test(id)) throw new ReaderError("unavailable");
  if (!integer(before)) throw new ReaderError("contract");
  const value = await read(`/works/${encodeURIComponent(id)}/timeline?before_version=${before}`, isTimeline, signal);
  if (before && (value.versions.some((x) => x.version >= before) || value.next_version_before >= before))
    throw new ReaderError("contract");
  return value;
}

export async function readVersion(id: string, number: number, signal?: AbortSignal) {
  if (!UUID.test(id) || !integer(number, 1)) throw new ReaderError("unavailable");
  const value = await read(`/works/${encodeURIComponent(id)}/versions/${number}`, isWork, signal);
  if (value.id !== id || value.version !== number) throw new ReaderError("contract");
  return value;
}

export function mergeVersions(previous: VersionEntry[], incoming: VersionEntry[]) {
  const map = new Map(previous.map((x) => [x.version, x]));
  for (const value of incoming) map.set(value.version, value);
  return [...map.values()].sort((a, b) => a.version - b.version);
}
