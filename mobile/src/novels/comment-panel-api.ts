import type { Transport } from "../auth/session.ts";
import type {
  Comment,
  CommentPage,
  CommentCreate,
  CommentAction,
} from "../api/comments.ts";
import { ApiError } from "../api/client.ts";
import { ChapterCommentsApi, type ChapterComment } from "./comments-api.ts";
// The existing panel uses work_id as its local topic key. Only this view adapter
// normalizes a chapter ID; HTTP and persistent objects retain explicit book/chapter IDs.
export function chapterCommentForPanel(value: ChapterComment): Comment {
  const { novel_id: _book, chapter_id, ...comment } = value;
  return { ...comment, work_id: chapter_id };
}
export function chapterPanelApi(
  transport: Transport,
  book: string,
  chapter: string,
) {
  const api = new ChapterCommentsApi(transport);
  return {
    async list(
      topic: string,
      cursor = 0,
      root?: string,
      signal?: AbortSignal,
    ): Promise<CommentPage> {
      if (topic !== chapter) throw new ApiError("invalid_input");
      const page = await api.list(book, chapter, cursor, root, signal);
      return { ...page, items: page.items.map(chapterCommentForPanel) };
    },
    async create(topic: string, body: CommentCreate) {
      if (topic !== chapter) throw new ApiError("invalid_input");
      return api.create(book, chapter, body);
    },
    async remove(comment: string, body: CommentAction) {
      if (body.reason !== "") throw new ApiError("invalid_input");
      return api.act(comment, body);
    },
  };
}
