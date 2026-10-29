import { APIError, syncAPI } from './api'
import type { DraftRepository } from './local-db'
import type { LocalDraft, Pending } from './types'

export type SyncState =
  | 'saved'
  | 'pending'
  | 'recovered'
  | 'login-required'
  | 'account-mismatch'
  | 'rejected'
  | 'busy'
export interface SyncResult {
  state: SyncState
  record?: LocalDraft
  errorCode?: string
  requestId?: string
}
export type SyncAPI = typeof syncAPI

export async function syncOne(
  db: DraftRepository,
  key: string,
  ownerId: string,
  api: SyncAPI = syncAPI,
): Promise<SyncResult> {
  const holder = crypto.randomUUID()
  if (!(await db.acquire(key, holder))) return { state: 'busy' }
  try {
    let record = await db.get(key)
    if (!record || record.ownerId !== ownerId) return { state: 'account-mismatch' }
    if (!record.dirty && !record.pending) return { state: 'saved', record }
    if (
      new TextEncoder().encode(record.content).length > 1_048_576 ||
      [...record.title].length > 200
    )
      return { state: 'rejected', record, errorCode: 'draft_too_large' }
    // Recheck actual session before transmitting a private local snapshot.
    if ((await api.me()).id !== ownerId) return { state: 'account-mismatch', record }
    if (!record.pending) {
      const server = await api.read(record.serverId)
      if (server.title === record.title && server.content === record.content) {
        await db.markAlreadySaved(record, server)
        return { state: 'saved', record: await db.get(key) }
      }
      const pending: Pending = {
        kind: server.revision === record.baseRevision ? 'save' : 'recover',
        mutation_id: crypto.randomUUID(),
        draft_id: record.serverId,
        base_revision: record.baseRevision,
        title: record.title,
        content: record.content,
      }
      // Persist request identity before the first HTTP attempt.
      if (!(await db.prepare(record, pending))) return { state: 'busy' }
      record = (await db.get(key))!
    }
    let pending = record.pending!
    try {
      const ack = await api.write(pending)
      await db.acknowledge(key, pending, ack)
    } catch (error) {
      if (
        !(error instanceof APIError) ||
        error.status !== 409 ||
        error.code !== 'revision_conflict' ||
        pending.kind !== 'save'
      )
        throw error
      const replacement: Pending = { ...pending, kind: 'recover', mutation_id: crypto.randomUUID() }
      await db.replacePending(key, pending.mutation_id, replacement)
      // A different context may already have resolved it. Never send an old fork blindly.
      const current = await db.get(key)
      if (current?.pending?.mutation_id !== replacement.mutation_id) return { state: 'busy' }
      pending = replacement
      const ack = await api.write(pending)
      await db.acknowledge(key, pending, ack)
    }
    const current = await db.get(key)
    return {
      state: pending.kind === 'recover' ? 'recovered' : current?.dirty ? 'pending' : 'saved',
      record: current,
    }
  } catch (error) {
    if (!(error instanceof APIError)) throw error
    if (error.status === 400 || error.status === 413) {
      const before = await db.get(key)
      if (before?.pending) {
        const changed =
          before.title !== before.pending.title || before.content !== before.pending.content
        await db.rejectPending(key, before.pending.mutation_id)
        return {
          state: changed ? 'pending' : 'rejected',
          record: await db.get(key),
          errorCode: error.code,
          requestId: error.requestId,
        }
      }
    }
    return {
      state:
        error.status === 401
          ? 'login-required'
          : error.status === 0 || error.status >= 500 || error.status === 429
            ? 'pending'
            : 'rejected',
      errorCode: error.code,
      requestId: error.requestId,
      record: await db.get(key),
    }
  } finally {
    await db.release(key, holder)
  }
}
