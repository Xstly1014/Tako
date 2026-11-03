/** Split only at Unicode code-point boundaries; retain every character. */
export function readingChunks(content: string, limit = 2000): string[] {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("invalid_chunk_limit");
  const result: string[] = [];
  let part = "",
    count = 0;
  for (const char of content) {
    part += char;
    count++;
    if (char === "\n" || count === limit) {
      result.push(part);
      part = "";
      count = 0;
    }
  }
  if (part) result.push(part);
  return result;
}
export function mergeReadingItems<T extends { id: string }>(
  old: T[],
  next: T[],
): T[] {
  const known = new Set(old.map((item) => item.id));
  return [
    ...old,
    ...next.filter((item) => {
      if (known.has(item.id)) return false;
      known.add(item.id);
      return true;
    }),
  ];
}
