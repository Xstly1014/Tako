import type { components } from '../../../mobile/src/api/contract'
export type NovelSchema<K extends keyof components['schemas']> = components['schemas'][K]
export type NovelOperation = {
  owner: string
  book: string
  kind: 'chapter' | 'metadata' | 'post' | 'limit' | 'case' | 'policy' | 'work-pre' | 'work-withdraw'
  policy_kind?: 'novel' | 'work'
  target: string
  version: number
  body: Record<string, unknown> & { mutation_id: string }
}
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) &&
  v !== '00000000-0000-0000-0000-000000000000'
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const reason = (v: unknown): v is string => typeof v === 'string' && Array.from(v).length <= 2000
export function checkedNovelOperation(v: unknown, owner: string): NovelOperation {
  const p = v as NovelOperation
  if (
    !p ||
    p.owner !== owner ||
    !uuid(p.owner) ||
    !uuid(p.book) ||
    !p.body ||
    !uuid(p.body.mutation_id) ||
    ![
      'chapter',
      'metadata',
      'post',
      'limit',
      'case',
      'policy',
      'work-pre',
      'work-withdraw',
    ].includes(p.kind) ||
    !Number.isSafeInteger(p.version) ||
    p.version < 0 ||
    (p.kind === 'case'
      ? !/^[1-9][0-9]*$/.test(p.target) || !positive(Number(p.target))
      : !uuid(p.target))
  )
    throw Error('invalid_operation')
  if (['chapter', 'metadata', 'post', 'work-pre'].includes(p.kind) && !positive(p.version))
    throw Error('invalid_operation')
  if (
    (p.kind === 'chapter' || p.kind === 'metadata' || p.kind === 'work-pre') &&
    (!['approve', 'reject'].includes(String(p.body.decision)) ||
      !reason(p.body.reason) ||
      (p.body.decision === 'reject' && !p.body.reason.trim()))
  )
    throw Error('invalid_operation')
  if (
    p.kind === 'case' &&
    (!['uphold', 'revoke'].includes(String(p.body.decision)) ||
      !positive(p.body.expected_revision) ||
      !reason(p.body.reason) ||
      !p.body.reason.trim() ||
      (p.body.decision === 'uphold' && !positive(p.body.appeal_id)))
  )
    throw Error('invalid_operation')
  if (
    p.kind === 'limit' &&
    (!['book', 'chapter', 'version'].includes(String(p.body.scope)) ||
      !positive(p.body.expected_revision) ||
      !reason(p.body.reason) ||
      !p.body.reason.trim() ||
      !Number.isSafeInteger(p.body.version) ||
      Number(p.body.version) < 0 ||
      (p.body.scope === 'book'
        ? p.body.chapter_id !== null || p.body.version !== 0
        : !uuid(p.body.chapter_id)) ||
      (p.body.scope === 'version' ? !positive(p.body.version) : p.body.version !== 0))
  )
    throw Error('invalid_operation')
  if (
    p.kind === 'policy' &&
    (!['start', 'extend', 'revoke'].includes(String(p.body.action)) ||
      !Number.isSafeInteger(p.body.expected_revision) ||
      Number(p.body.expected_revision) < 0 ||
      !reason(p.body.reason) ||
      !p.body.reason.trim() ||
      p.target !== p.book ||
      p.version !== 0)
  )
    throw Error('invalid_operation')
  if (p.kind === 'work-withdraw' && (p.version !== 0 || Object.keys(p.body).length !== 1))
    throw Error('invalid_operation')
  if (
    p.policy_kind !== undefined &&
    (p.kind !== 'policy' || !['novel', 'work'].includes(p.policy_kind))
  )
    throw Error('invalid_operation')
  return p
}
export function novelOperationPaths(p: NovelOperation) {
  checkedNovelOperation(p, p.owner)
  const base = `/ops/novels/${p.book}`,
    mine = `/my/novels/${p.book}`
  const id = p.body.mutation_id
  switch (p.kind) {
    case 'work-withdraw':
      return {
        write: `/my/work-submissions/${p.target}/withdraw`,
        receipt: `/work-submission-requests/${id}`,
      }
    case 'work-pre':
      return {
        write: `/ops/work-submissions/${p.target}/review`,
        receipt: `/work-submission-requests/${id}`,
      }
    case 'policy':
      return {
        write: `${p.policy_kind === 'work' ? `/ops/works/${p.book}` : base}/author-policy`,
        receipt: `${p.policy_kind === 'work' ? `/ops/works/${p.book}` : base}/author-policy/requests/${id}`,
      }
    case 'chapter':
      return {
        write: `${base}/chapter-submissions/${p.target}/review`,
        receipt: `${mine}/publication-requests/${id}`,
      }
    case 'metadata':
      return {
        write: `${base}/metadata-submissions/${p.target}/review`,
        receipt: `${mine}/metadata-requests/${id}`,
      }
    case 'post':
      return {
        write: `${base}/post-reviews/${p.target}`,
        receipt: `${base}/post-review-requests/${id}`,
      }
    case 'limit':
      return { write: `${base}/limits`, receipt: `${mine}/moderation-requests/${id}` }
    case 'case':
      return {
        write: `${base}/moderation/${p.target}`,
        receipt: `${mine}/moderation-requests/${id}`,
      }
  }
}
export function confirmNovelOperation(p: NovelOperation, value: unknown) {
  const v = value as Record<string, unknown>
  if (
    !v ||
    (p.kind === 'policy'
      ? v.context_id !== p.book || v.context_kind !== (p.policy_kind ?? 'novel')
      : p.kind === 'work-pre' || p.kind === 'work-withdraw'
        ? v.work_id !== p.book
        : v.novel_id !== p.book)
  )
    throw Error('invalid_receipt')
  if (p.kind === 'work-withdraw') {
    if (
      v.mutation_id !== p.body.mutation_id ||
      v.submission_id !== p.target ||
      v.work_id !== p.book ||
      v.state !== 'withdrawn' ||
      v.version !== 0
    )
      throw Error('invalid_receipt')
    return
  }
  if (p.kind === 'work-pre') {
    if (
      v.mutation_id !== p.body.mutation_id ||
      v.submission_id !== p.target ||
      v.work_id !== p.book ||
      v.state !== (p.body.decision === 'approve' ? 'published' : 'rejected') ||
      v.version !== (p.body.decision === 'approve' ? p.version : 0)
    )
      throw Error('invalid_receipt')
    return
  }
  if (p.kind === 'policy') {
    if (
      v.mutation_id !== p.body.mutation_id ||
      v.action !== p.body.action ||
      v.revision !== Number(p.body.expected_revision) + 1 ||
      v.reason !== p.body.reason ||
      typeof v.created_at !== 'string' ||
      !Number.isFinite(Date.parse(v.created_at)) ||
      (p.body.action === 'revoke'
        ? v.observation_until !== null
        : typeof v.observation_until !== 'string' ||
          !Number.isFinite(Date.parse(v.observation_until)))
    )
      throw Error('invalid_receipt')
    return
  }
  if (p.kind === 'case' || p.kind === 'limit') {
    if (
      p.kind === 'limit'
        ? v.operation !== 'limit' ||
          v.state !== 'active' ||
          v.revision !== 1 ||
          !positive(v.id) ||
          v.case_id !== v.id
        : v.operation !== p.body.decision ||
          v.case_id !== Number(p.target) ||
          v.id !== Number(p.target) ||
          v.revision !== Number(p.body.expected_revision) + 1 ||
          v.state !== (p.body.decision === 'revoke' ? 'revoked' : 'active')
    )
      throw Error('invalid_receipt')
    return
  }
  if (v.mutation_id !== p.body.mutation_id || v.submission_id !== p.target)
    throw Error('invalid_receipt')
  if (p.kind === 'post') {
    if (v.operation !== 'post_review' || v.state !== 'reviewed' || v.version !== p.version)
      throw Error('invalid_receipt')
  } else if (p.kind === 'chapter') {
    if (
      v.operation !== 'review' ||
      v.state !== (p.body.decision === 'approve' ? 'published' : 'rejected') ||
      v.version !== (p.body.decision === 'approve' ? p.version : 0)
    )
      throw Error('invalid_receipt')
  } else if (
    v.operation !== 'review_metadata' ||
    v.candidate_revision !== p.version ||
    v.state !== (p.body.decision === 'approve' ? 'published' : 'rejected') ||
    v.revision !== (p.body.decision === 'approve' ? p.version : 0)
  )
    throw Error('invalid_receipt')
}

// Only operator reasons and target IDs, never fixed chapter text. Failed storage
// stops the write. Each tab's record remains bound to its authenticated operator.
export class NovelOperationJournal {
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  private owner: string
  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, owner: string) {
    this.storage = storage
    this.owner = owner
  }
  private key() {
    return `tako-novel-operations-v1:${this.owner}`
  }
  load() {
    const raw = this.storage.getItem(this.key())
    return raw === null ? null : checkedNovelOperation(JSON.parse(raw), this.owner)
  }
  save(p: NovelOperation) {
    checkedNovelOperation(p, this.owner)
    const old = this.load()
    if (old && JSON.stringify(old) !== JSON.stringify(p)) throw Error('pending_operation')
    this.storage.setItem(this.key(), JSON.stringify(p))
  }
  clear(mutation: string) {
    const old = this.load()
    if (old && old.body.mutation_id !== mutation) throw Error('pending_operation')
    this.storage.removeItem(this.key())
  }
}
