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
  published?: PublicationResult
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

export interface WorkState {
  id: string
  draft_id: string
  last_version: number
  display_version: number
  author_hidden: boolean
  history_open: boolean
  platform_limited: boolean
  state_revision: number
}
export interface WorkEvent {
  sequence: number
  kind: string
  version: number
  created_at: string
}
export interface PublicVersionEntry {
  version: number
  published_at: string
  is_current: boolean
  readable: boolean
}
export interface PublicTimeline {
  history_open: boolean
  versions: PublicVersionEntry[]
  events: WorkEvent[]
  next_version_before: number
  next_event_before: number
}
export interface AuthorVersionEntry {
  version: number
  title: string
  published_at: string
  platform_limited: boolean
  review_status: string
}
export interface AuthorTimeline {
  state: WorkState
  versions: AuthorVersionEntry[]
  events: WorkEvent[]
  next_version_before: number
  next_event_before: number
}
export interface AuthorWorkSummary {
  id: string
  title: string
  draft_id: string
  author_hidden: boolean
  platform_limited: boolean
  display_version: number
  last_version: number
}
export interface AuthorWorkPage {
  items: AuthorWorkSummary[]
  next_cursor: string
}
export interface WorkChange {
  mutation_id: string
  expected_state_revision: number
  action: 'hide' | 'restore' | 'switch_display' | 'set_history'
  version?: number
  history_open?: boolean
}
