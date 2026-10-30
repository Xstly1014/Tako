export type WorkCard = {
  id: string
  version: number
  title: string
  introduction: string
  tags: string[]
  author_nickname: string
  first_published_at: string
}
export type DiscoveryPage = {
  items: WorkCard[]
  featured: WorkCard[]
  tags: { name: string; count: number }[]
  next_cursor: string
}
export type CurationState = {
  revision: number
  slots: { slot: number; work_id: string | null; work: WorkCard | null }[]
}
export type CurationCandidate = { work: WorkCard; state_revision: number }
export type CurationChange = {
  mutation_id: string
  expected_revision: number
  slot: number
  work_id: string | null
  expected_work_revision: number
}
