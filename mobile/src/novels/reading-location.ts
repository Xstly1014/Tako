/** Version 1 positions use LF logical paragraphs and Unicode code-point offsets.
 * Rendering chunk size is deliberately excluded from the persisted location.
 */
export type ReadingLocation = {
  algorithm: 1;
  paragraph: number;
  offset: number;
};
export type LocatedChunk = {
  text: string;
  paragraph: number;
  offset: number;
  length: number;
};
export const logicalParagraphs = (content: string): string[] =>
  content.replace(/\r\n?/g, "\n").split("\n");
export function locatedReadingChunks(
  content: string,
  limit = 2000,
): LocatedChunk[] {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("invalid_chunk_limit");
  const paragraphs = logicalParagraphs(content),
    chunks: LocatedChunk[] = [];
  paragraphs.forEach((text, paragraph) => {
    const start = chunks.length;
    let part = "",
      offset = 0,
      length = 0;
    for (const char of text) {
      part += char;
      length++;
      if (length === limit) {
        chunks.push({ text: part, paragraph, offset, length });
        offset += length;
        part = "";
        length = 0;
      }
    }
    if (part || chunks.length === start)
      chunks.push({ text: part, paragraph, offset, length });
    if (paragraph < paragraphs.length - 1)
      chunks[chunks.length - 1].text += "\n";
  });
  return chunks;
}
export function validReadingLocation(
  content: string,
  value: unknown,
): value is ReadingLocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !== "algorithm,offset,paragraph" ||
    v.algorithm !== 1 ||
    !Number.isSafeInteger(v.paragraph) ||
    Number(v.paragraph) < 0 ||
    !Number.isSafeInteger(v.offset) ||
    Number(v.offset) < 0
  )
    return false;
  const paragraphs = logicalParagraphs(content),
    paragraph = v.paragraph as number;
  if (paragraph >= paragraphs.length) return false;
  let size = 0;
  for (const _ of paragraphs[paragraph]) {
    void _;
    size++;
  }
  return Number(v.offset) <= size;
}
/** At a chunk boundary prefer the following chunk; paragraph-end stays in its last chunk. */
export function readingChunkIndex(
  content: string,
  location: ReadingLocation,
  limit = 2000,
): number {
  if (!validReadingLocation(content, location))
    throw new Error("invalid_reading_location");
  const chunks = locatedReadingChunks(content, limit);
  let found = -1;
  chunks.forEach((chunk, i) => {
    if (
      chunk.paragraph === location.paragraph &&
      chunk.offset <= location.offset
    )
      found = i;
  });
  return found;
}
