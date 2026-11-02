import type { paths } from "./contract";
import { isCard, read, ReaderError } from "./reader.ts";
export type SearchPage =
  paths["/api/search"]["get"]["responses"][200]["content"]["application/json"];
export function searchQuery(value: string): string | null {
  const q = value.trim(),
    chars = Array.from(q);
  if (
    !chars.length ||
    chars.length > 64 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
    chars.some((c) => {
      const n = c.codePointAt(0)!;
      return n >= 0xd800 && n <= 0xdfff;
    })
  )
    return null;
  return q;
}
export function isSearchPage(value: unknown): value is SearchPage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).every((k) => ["items", "next_cursor"].includes(k)) &&
    Array.isArray(v.items) &&
    v.items.length <= 12 &&
    v.items.every(
      (item) =>
        isCard(item) &&
        Object.keys(item).every((k) =>
          [
            "id",
            "version",
            "title",
            "introduction",
            "tags",
            "author_nickname",
            "first_published_at",
          ].includes(k),
        ) &&
        Array.from(item.title).length <= 200 &&
        Array.from(item.introduction).length <= 300 &&
        Array.from(item.author_nickname).length <= 64 &&
        item.tags.length >= 1 &&
        item.tags.length <= 3 &&
        !Number.isNaN(Date.parse(item.first_published_at)),
    ) &&
    typeof v.next_cursor === "string" &&
    v.next_cursor.length <= 512
  );
}
export function searchWorks(
  query: string,
  cursor = "",
  signal?: AbortSignal,
): Promise<SearchPage> {
  const q = searchQuery(query);
  if (q === null || cursor.length > 512)
    return Promise.reject(new ReaderError("contract"));
  const params = new URLSearchParams({ q });
  if (cursor) params.set("cursor", cursor);
  return read(`/search?${params}`, isSearchPage, signal);
}
