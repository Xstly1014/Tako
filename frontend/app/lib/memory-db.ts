import type { DraftRepository } from './local-db'
import type { Ack, LocalDraft, Pending, ServerDraft } from './types'

// Degraded mode only. This does not pretend to persist across a page reload.
export class MemoryDB implements DraftRepository {
  private rows = new Map<string, LocalDraft>()
  private locks = new Map<string, { holder: string; until: number }>()
  seed(rows: LocalDraft[]) {
    for (const row of rows)
      if (!this.rows.has(row.key)) this.rows.set(row.key, structuredClone(row))
  }
  async get(key: string) {
    const row = this.rows.get(key)
    return row ? structuredClone(row) : undefined
  }
  async all(owner: string) {
    return [...this.rows.values()]
      .filter((row) => row.ownerId === owner)
      .map((row) => structuredClone(row))
  }
  async ensure(ownerId: string, server: ServerDraft, workspaceId: string) {
    const choices = [...this.rows.values()].filter(
      (row) => row.ownerId === ownerId && row.serverId === server.id,
    )
    const previous =
      choices.find((row) => row.workspaceId === workspaceId) ??
      choices.find((row) => !row.dirty && !row.pending)
    if (previous) {
      if (!previous.dirty && !previous.pending)
        Object.assign(previous, {
          seq:
            previous.seq +
            (previous.baseRevision !== server.revision ||
            previous.title !== server.title ||
            previous.content !== server.content
              ? 1
              : 0),
          title: server.title,
          content: server.content,
          baseRevision: server.revision,
          savedAt: server.saved_at,
        })
      return structuredClone(previous)
    }
    const row: LocalDraft = {
      key: crypto.randomUUID(),
      ownerId,
      workspaceId,
      serverId: server.id,
      baseRevision: server.revision,
      title: server.title,
      content: server.content,
      savedAt: server.saved_at,
      seq: 0,
      dirty: false,
      updatedAt: Date.now(),
    }
    this.rows.set(row.key, row)
    return structuredClone(row)
  }
  async edit(
    key: string,
    owner: string,
    seq: number,
    title: string,
    content: string,
    workspaceId: string,
    basis?: LocalDraft,
  ) {
    const previous = this.rows.get(key)
    if (!previous || previous.ownerId !== owner) throw new Error('local_owner_mismatch')
    const row =
      previous.seq === seq
        ? previous
        : {
            ...previous,
            key: crypto.randomUUID(),
            workspaceId,
            pending: undefined,
            serverId: basis?.serverId ?? previous.serverId,
            baseRevision: basis?.baseRevision ?? previous.baseRevision,
            savedAt: basis?.savedAt ?? previous.savedAt,
          }
    Object.assign(row, { title, content, seq: row.seq + 1, dirty: true, updatedAt: Date.now() })
    this.rows.set(row.key, row)
    return structuredClone(row)
  }
  async prepare(snapshot: LocalDraft, pending: Pending) {
    const row = this.rows.get(snapshot.key)
    if (
      !row ||
      row.seq !== snapshot.seq ||
      row.pending ||
      row.serverId !== snapshot.serverId ||
      row.baseRevision !== snapshot.baseRevision
    )
      return false
    row.pending = structuredClone(pending)
    return true
  }
  async replacePending(key: string, oldId: string, pending: Pending) {
    const row = this.rows.get(key)
    if (row?.pending?.mutation_id === oldId) row.pending = structuredClone(pending)
  }
  async acknowledge(key: string, pending: Pending, ack: Ack) {
    const row = this.rows.get(key)
    if (!row || row.pending?.mutation_id !== pending.mutation_id) return
    Object.assign(row, {
      serverId: ack.draft_id,
      baseRevision: ack.revision,
      savedAt: ack.saved_at,
      pending: undefined,
      dirty: row.title !== pending.title || row.content !== pending.content,
    })
  }
  async rejectPending(key: string, id: string) {
    const row = this.rows.get(key)
    if (row?.pending?.mutation_id === id) row.pending = undefined
  }
  async markAlreadySaved(snapshot: LocalDraft, server: ServerDraft) {
    const row = this.rows.get(snapshot.key)
    if (row && !row.pending && row.seq === snapshot.seq)
      Object.assign(row, { baseRevision: server.revision, savedAt: server.saved_at, dirty: false })
  }
  async acquire(key: string, holder: string) {
    const old = this.locks.get(key)
    if (old && old.until > Date.now()) return false
    this.locks.set(key, { holder, until: Date.now() + 30_000 })
    return true
  }
  async release(key: string, holder: string) {
    if (this.locks.get(key)?.holder === holder) this.locks.delete(key)
  }
}
let fallback: MemoryDB | undefined
export function existingFallback() {
  return fallback
}
export function memoryFallback(rows: LocalDraft[] = []) {
  fallback ??= new MemoryDB()
  fallback.seed(rows)
  return fallback
}
