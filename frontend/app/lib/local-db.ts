import Dexie, { type Table } from 'dexie'
import type { Ack, LocalDraft, Pending, ServerDraft } from './types'

interface Lease {
  key: string
  holder: string
  until: number
}
export class LocalDB extends Dexie {
  drafts!: Table<LocalDraft, string>
  leases!: Table<Lease, string>
  constructor(name = 'tako-writing-v1') {
    super(name)
    this.version(1).stores({ drafts: 'key, ownerId, [ownerId+serverId]', leases: 'key' })
  }
  async get(key: string) {
    return await this.drafts.get(key)
  }
  async all(ownerId: string) {
    return await this.drafts.where('ownerId').equals(ownerId).toArray()
  }
  async ensure(ownerId: string, server: ServerDraft, workspaceId: string) {
    return this.transaction('rw', this.drafts, async () => {
      const entries = await this.drafts
        .where('[ownerId+serverId]')
        .equals([ownerId, server.id])
        .toArray()
      const reusable =
        entries.find((x) => x.workspaceId === workspaceId) ??
        entries.find((x) => !x.dirty && !x.pending)
      if (reusable) {
        if (!reusable.dirty && !reusable.pending) {
          const changed =
            reusable.baseRevision !== server.revision ||
            reusable.title !== server.title ||
            reusable.content !== server.content
          const refreshed = {
            ...reusable,
            seq: reusable.seq + (changed ? 1 : 0),
            title: server.title,
            content: server.content,
            baseRevision: server.revision,
            savedAt: server.saved_at,
          }
          await this.drafts.put(refreshed)
          return refreshed
        }
        return reusable
      }
      const draft: LocalDraft = {
        key: crypto.randomUUID(),
        ownerId,
        workspaceId,
        serverId: server.id,
        baseRevision: server.revision,
        savedAt: server.saved_at,
        title: server.title,
        content: server.content,
        seq: 0,
        dirty: false,
        updatedAt: Date.now(),
      }
      await this.drafts.add(draft)
      return draft
    })
  }
  async edit(
    key: string,
    ownerId: string,
    expectedSeq: number,
    title: string,
    content: string,
    workspaceId: string,
    basis?: LocalDraft,
  ) {
    return this.transaction('rw', this.drafts, async () => {
      const old = await this.drafts.get(key)
      if (!old || old.ownerId !== ownerId) throw new Error('local_owner_mismatch')
      // Another tab edited this same record: preserve it and fork locally.
      const current: LocalDraft =
        old.seq === expectedSeq
          ? old
          : {
              ...old,
              key: crypto.randomUUID(),
              workspaceId,
              pending: undefined,
              serverId: basis?.serverId ?? old.serverId,
              baseRevision: basis?.baseRevision ?? old.baseRevision,
              savedAt: basis?.savedAt ?? old.savedAt,
            }
      current.title = title
      current.content = content
      current.seq++
      current.dirty = true
      current.updatedAt = Date.now()
      await this.drafts.put(current)
      return current
    })
  }
  async prepare(snapshot: LocalDraft, pending: Pending) {
    return this.transaction('rw', this.drafts, async () => {
      const current = await this.drafts.get(snapshot.key)
      if (
        !current ||
        current.seq !== snapshot.seq ||
        current.pending ||
        current.serverId !== snapshot.serverId ||
        current.baseRevision !== snapshot.baseRevision
      )
        return false
      await this.drafts.update(snapshot.key, { pending })
      return true
    })
  }
  async replacePending(key: string, oldId: string, pending: Pending) {
    return this.transaction('rw', this.drafts, async () => {
      const current = await this.drafts.get(key)
      if (current?.pending?.mutation_id === oldId) await this.drafts.update(key, { pending })
    })
  }
  async acknowledge(key: string, pending: Pending, ack: Ack) {
    return this.transaction('rw', this.drafts, async () => {
      const current = await this.drafts.get(key)
      if (!current || current.pending?.mutation_id !== pending.mutation_id) return
      await this.drafts.update(key, {
        serverId: ack.draft_id,
        baseRevision: ack.revision,
        savedAt: ack.saved_at,
        pending: undefined,
        dirty: current.title !== pending.title || current.content !== pending.content,
      })
    })
  }
  async rejectPending(key: string, id: string) {
    return this.transaction('rw', this.drafts, async () => {
      const current = await this.drafts.get(key)
      if (current?.pending?.mutation_id === id)
        await this.drafts.update(key, { pending: undefined })
    })
  }
  async markAlreadySaved(snapshot: LocalDraft, server: ServerDraft) {
    return this.transaction('rw', this.drafts, async () => {
      const current = await this.drafts.get(snapshot.key)
      if (!current || current.pending || current.seq !== snapshot.seq) return
      await this.drafts.update(current.key, {
        baseRevision: server.revision,
        savedAt: server.saved_at,
        dirty: false,
      })
    })
  }
  async acquire(key: string, holder: string) {
    return this.transaction('rw', this.leases, async () => {
      const lease = await this.leases.get(key)
      if (lease && lease.until > Date.now()) return false
      await this.leases.put({ key, holder, until: Date.now() + 30_000 })
      return true
    })
  }
  async release(key: string, holder: string) {
    await this.transaction('rw', this.leases, async () => {
      if ((await this.leases.get(key))?.holder === holder) await this.leases.delete(key)
    })
  }
}
export type DraftRepository = Pick<
  LocalDB,
  | 'get'
  | 'all'
  | 'ensure'
  | 'edit'
  | 'prepare'
  | 'replacePending'
  | 'acknowledge'
  | 'rejectPending'
  | 'markAlreadySaved'
  | 'acquire'
  | 'release'
>
