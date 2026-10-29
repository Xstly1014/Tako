export interface Account {
  id: string
  nickname: string
}
export interface ServerDraft {
  id: string
  title: string
  content: string
  revision: number
  saved_at: string
}
export interface Summary {
  id: string
  title: string
  revision: number
  saved_at: string
  created_at: string
  recovered_from: string | null
}
export interface Page {
  items: Summary[]
  next_cursor: string
}
export interface Ack {
  draft_id: string
  revision: number
  saved_at: string
}
export interface Pending {
  kind: 'save' | 'recover'
  mutation_id: string
  draft_id: string
  base_revision: number
  title: string
  content: string
}
export interface LocalDraft {
  key: string
  ownerId: string
  workspaceId: string
  serverId: string
  baseRevision: number
  savedAt: string
  title: string
  content: string
  seq: number
  dirty: boolean
  updatedAt: number
  pending?: Pending
}
