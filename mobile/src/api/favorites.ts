import type { components } from "./contract";
import { UUID } from "./reader.ts";
import { ApiError } from "./client.ts";
export type FavoriteState = components["schemas"]["FavoriteState"];
export type FavoritePage = components["schemas"]["FavoritePage"];
export type FavoriteItem = FavoritePage["items"][number];
export type FavoriteChange = components["schemas"]["FavoriteChange"];
export function checkedState(value: FavoriteState) {
  if (
    !value ||
    !UUID.test(value.work_id) ||
    typeof value.favorite !== "boolean" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0
  )
    throw new ApiError("contract");
  return value;
}
export function checkedPage(value: FavoritePage) {
  if (
    !value ||
    !Array.isArray(value.items) ||
    typeof value.next_cursor !== "string"
  )
    throw new ApiError("contract");
  for (const item of value.items) {
    if (
      !UUID.test(item.work_id) ||
      !Number.isSafeInteger(item.revision) ||
      typeof item.saved_at !== "string" ||
      !(
        item.work === null ||
        (item.work &&
          typeof item.work.title === "string" &&
          typeof item.work.author_nickname === "string")
      )
    )
      throw new ApiError("contract");
  }
  return value;
}
