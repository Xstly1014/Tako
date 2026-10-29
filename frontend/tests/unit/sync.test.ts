import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalDB } from '../../app/lib/local-db'
import { MemoryDB } from '../../app/lib/memory-db'
import { APIError } from '../../app/lib/api'
import { syncOne, type SyncAPI } from '../../app/lib/sync'
import type { Ack, Pending, ServerDraft } from '../../app/lib/types'

const owner = 'a439d2c0-ed19-47e8-8289-e36649842d7e'
const source = '9ddc536a-eeb7-494e-a8d5-f91bb32ffb97'
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
describe('durable draft synchronization', () => {
  let db: LocalDB
  let server: ServerDraft
  let api: SyncAPI
  const outcomes = new Map<string, Ack>()
  beforeEach(() => {
    db = new LocalDB(`test-${crypto.randomUUID()}`)
    server = {
      id: source,
      title: '标题',
      content: '原文',
      revision: 1,
      saved_at: '2026-10-29T10:00:00Z',
    }
    outcomes.clear()
    api = {
      me: vi.fn(async () => ({ id: owner, nickname: '作者' })),
      read: vi.fn(async () => ({ ...server })),
      write: vi.fn(async (p: Pending) => {
        const previous = outcomes.get(p.mutation_id)
        if (previous) return previous
        const ack = {
          draft_id: p.kind === 'recover' ? crypto.randomUUID() : source,
          revision: p.kind === 'recover' ? 1 : server.revision + 1,
          saved_at: '2026-10-29T10:01:00Z',
        }
        outcomes.set(p.mutation_id, ack)
        if (p.kind === 'save')
          server = {
            ...server,
            title: p.title,
            content: p.content,
            revision: ack.revision,
            saved_at: ack.saved_at,
          }
        return ack
      }),
    }
  })
  afterEach(async () => {
    await db.delete()
  })
  async function edited(content = '新文字') {
    const row = await db.ensure(owner, server, 'tab-a')
    return db.edit(row.key, owner, row.seq, row.title, content, 'tab-a')
  }

  it('keeps newer input when an older save acknowledgement arrives', async () => {
    const row = await edited('第一段')
    const started = deferred<void>()
    const release = deferred<void>()
    const normal = api.write
    api.write = vi.fn(async (p) => {
      started.resolve()
      await release.promise
      return normal(p)
    })
    const work = syncOne(db, row.key, owner, api)
    await started.promise
    await db.edit(row.key, owner, row.seq, row.title, '第二段仍在输入', 'tab-a')
    release.resolve()
    const result = await work
    expect(result.record?.content).toBe('第二段仍在输入')
    expect(result.record?.dirty).toBe(true)
    await syncOne(db, row.key, owner, api)
    expect(server.content).toBe('第二段仍在输入')
  })
  it('reopens the DB and retries the exact request after an unknown outcome', async () => {
    const row = await edited()
    const normal = api.write
    let first = true
    api.write = vi.fn(async (p) => {
      const ack = await normal(p)
      if (first) {
        first = false
        throw new APIError(0, 'network_unconfirmed')
      }
      return ack
    })
    expect((await syncOne(db, row.key, owner, api)).state).toBe('pending')
    const mutation = (await db.drafts.get(row.key))?.pending?.mutation_id
    const name = db.name
    db.close()
    db = new LocalDB(name)
    expect((await syncOne(db, row.key, owner, api)).state).toBe('saved')
    expect(vi.mocked(api.write).mock.calls[1]?.[0].mutation_id).toBe(mutation)
    expect(outcomes.size).toBe(1)
    expect(server.revision).toBe(2)
  })
  it('automatically recovers changed server content and deduplicates recovery retries', async () => {
    const row = await edited('本机文字')
    server = { ...server, content: '手机修改', revision: 2 }
    const normal = api.write
    let first = true
    api.write = vi.fn(async (p) => {
      const result = await normal(p)
      if (first) {
        first = false
        throw new APIError(0, 'network_unconfirmed')
      }
      return result
    })
    await syncOne(db, row.key, owner, api)
    const pending = (await db.drafts.get(row.key))?.pending
    expect(pending?.kind).toBe('recover')
    const result = await syncOne(db, row.key, owner, api)
    expect(result.state).toBe('recovered')
    expect(result.record?.serverId).not.toBe(source)
    expect(server.content).toBe('手机修改')
    expect(outcomes.size).toBe(1)
  })
  it('turns a late revision conflict into a persisted recovery request', async () => {
    const row = await edited()
    const normal = api.write
    api.write = vi.fn(async (p) => {
      if (p.kind === 'save') throw new APIError(409, 'revision_conflict')
      return normal(p)
    })
    const result = await syncOne(db, row.key, owner, api)
    expect(result.state).toBe('recovered')
    expect(result.record?.pending).toBeUndefined()
  })
  it('never transmits local content under another account', async () => {
    const row = await edited()
    api.me = vi.fn(async () => ({ id: crypto.randomUUID(), nickname: '其他人' }))
    expect((await syncOne(db, row.key, owner, api)).state).toBe('account-mismatch')
    expect(api.read).not.toHaveBeenCalled()
    expect(api.write).not.toHaveBeenCalled()
    expect((await db.drafts.get(row.key))?.dirty).toBe(true)
  })
  it('preserves drafts through expired sessions and later resumes', async () => {
    const row = await edited()
    const normal = api.me
    api.me = vi.fn(async () => {
      throw new APIError(401, 'authentication_required')
    })
    expect((await syncOne(db, row.key, owner, api)).state).toBe('login-required')
    expect((await db.drafts.get(row.key))?.content).toBe('新文字')
    api.me = normal
    expect((await syncOne(db, row.key, owner, api)).state).toBe('saved')
  })
  it('forks local records instead of overwriting another tab', async () => {
    const row = await db.ensure(owner, server, 'tab-a')
    const a = await db.edit(row.key, owner, 0, row.title, 'A 的文字', 'tab-a')
    const b = await db.edit(row.key, owner, 0, row.title, 'B 的文字', 'tab-b')
    expect(a.key).not.toBe(b.key)
    expect((await db.drafts.get(a.key))?.content).toBe('A 的文字')
    expect((await db.drafts.get(b.key))?.content).toBe('B 的文字')
  })
  it('keeps one in-flight synchronization per local record', async () => {
    const row = await edited()
    const started = deferred<void>()
    const release = deferred<void>()
    const normal = api.write
    api.write = vi.fn(async (p) => {
      started.resolve()
      await release.promise
      return normal(p)
    })
    const first = syncOne(db, row.key, owner, api)
    await started.promise
    expect((await syncOne(db, row.key, owner, api)).state).toBe('busy')
    release.resolve()
    await first
    expect(api.write).toHaveBeenCalledTimes(1)
  })
  it('can save corrected input after a definitive rejection', async () => {
    const row = await edited()
    const normal = api.write
    api.write = vi.fn(async () => {
      throw new APIError(400, 'invalid_input')
    })
    expect((await syncOne(db, row.key, owner, api)).state).toBe('rejected')
    expect((await db.drafts.get(row.key))?.pending).toBeUndefined()
    const latest = (await db.drafts.get(row.key))!
    await db.edit(row.key, owner, latest.seq, latest.title, '修正后', 'tab-a')
    api.write = normal
    expect((await syncOne(db, row.key, owner, api)).state).toBe('saved')
  })
  it('can still save to the server when persistent browser storage is unavailable', async () => {
    const memory = new MemoryDB()
    const original = await memory.ensure(owner, server, 'degraded')
    const row = await memory.edit(
      original.key,
      owner,
      original.seq,
      original.title,
      '仍可保存到服务端',
      'degraded',
    )
    expect((await syncOne(memory, row.key, owner, api)).state).toBe('saved')
    expect(server.content).toBe('仍可保存到服务端')
    expect(await memory.all('another-account')).toEqual([])
  })
  it('refreshes a clean cache but never replaces an unsynchronized draft', async () => {
    const first = await db.ensure(owner, server, 'tab-a')
    server = { ...server, revision: 2, content: '其他设备已保存' }
    expect((await db.ensure(owner, server, 'tab-a')).content).toBe('其他设备已保存')
    const row = (await db.get(first.key))!
    await db.edit(row.key, owner, row.seq, row.title, '本机未同步', 'tab-a')
    server = { ...server, revision: 3, content: '服务端第三版' }
    expect((await db.ensure(owner, server, 'tab-a')).content).toBe('本机未同步')
  })
  it('does not inherit a newer baseline when another tab refreshed the shared cache', async () => {
    const original = await db.ensure(owner, server, 'tab-a')
    server = { ...server, revision: 2, content: '其他设备的新版本' }
    await db.ensure(owner, server, 'tab-b')
    const fork = await db.edit(
      original.key,
      owner,
      original.seq,
      original.title,
      '旧编辑页继续写',
      'tab-a',
      original,
    )
    expect(fork.baseRevision).toBe(1)
    expect((await syncOne(db, fork.key, owner, api)).state).toBe('recovered')
    expect(server.content).toBe('其他设备的新版本')
  })
})
