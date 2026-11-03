import type { Transport } from "../../auth/session.ts";
import { ApiError } from "../../api/client.ts";
import { DraftsApi } from "../../drafts/api.ts";
import { id } from "../../drafts/model.ts";
// Scope every generic C1 request to this book. Recovery changes draft identity
// and chapter identity on the server, while this book scope remains correct.
export function chapterDraftsApi(transport: Transport, book: string) {
  if (!id(book)) throw new ApiError("invalid_input");
  return new DraftsApi((path, options) => {
    if (path === "/me") return transport(path, options);
    if (!/^\/drafts(?:[/?]|$)/.test(path)) throw new ApiError("invalid_input");
    return transport(
      `/my/novels/${book}/chapter-drafts` + path.slice(7),
      options,
    );
  });
}
