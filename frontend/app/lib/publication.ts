export const publicationTags = ['幻想', '冒险', '日常', '情感', '悬疑', '科幻'] as const
export interface PublicationPreview {
  id: string
  draft_id: string
  source_revision: number
  expected_version: number
  title: string
  content: string
  introduction: string
  tags: string[]
  created_at: string
  expires_at: string
}
export interface PublicationResult {
  work_id: string
  version: number
  published_at: string
  review_status: 'pending'
}
export interface PublicWork {
  id: string
  version: number
  title: string
  content: string
  introduction: string
  tags: string[]
  author_nickname: string
  published_at: string
}
