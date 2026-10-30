import type { PublicWork } from './publication'
export interface ModerationTask {
  id: number
  work_id: string
  version: number
  revision: number
  state: string
  first_waiting_at: string
  is_current: boolean
  title: string
}
export interface ModerationCase {
  id: number
  work_id: string
  version: number
  scope: 'version' | 'work'
  reason: string
  state: string
  revision: number
  created_at: string
  next_appeal_at: string | null
}
export interface Appeal {
  id: number
  case_id: number
  reason: string
  state: string
  decision_reason: string
  created_at: string
  decided_at: string | null
}
export interface ModPage<T> {
  items: T[]
  next: number
}
export interface ModDetail {
 revocation?: {reason:string;created_at:string}|null
  task?: ModerationTask
  case?: ModerationCase
  appeals?: ModPage<Appeal>
  work: PublicWork
}
export interface ModAction {
  mutation_id: string
  expected_revision: number
  decision: string
  reason: string
  appeal_id?: number
}
