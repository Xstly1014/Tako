import { describe, it, expect } from 'vitest'
import {
  NovelOperationJournal,
  novelOperationPaths,
  confirmNovelOperation,
  type NovelOperation,
} from '../../app/lib/novel-operations'
const owner = '11111111-1111-4111-8111-111111111111',
  book = '22222222-2222-4222-8222-222222222222',
  target = '33333333-3333-4333-8333-333333333333',
  mutation = '44444444-4444-4444-8444-444444444444'
function setup() {
  const rows = new Map<string, string>()
  return {
    rows,
    storage: {
      getItem: (k: string) => rows.get(k) ?? null,
      setItem: (k: string, v: string) => {
        rows.set(k, v)
      },
      removeItem: (k: string) => {
        rows.delete(k)
      },
    },
  }
}
const command = (): NovelOperation => ({
  owner,
  book,
  kind: 'chapter',
  target,
  version: 1,
  body: { mutation_id: mutation, decision: 'approve', reason: '' },
})
describe('小说运营原处理记录', () => {
  it('原提交持久化后重开可恢复，换账号隔离，不能被新处理覆盖', () => {
    const f = setup(),
      journal = new NovelOperationJournal(f.storage, owner),
      p = command()
    journal.save(p)
    expect(new NovelOperationJournal(f.storage, owner).load()).toEqual(p)
    expect(new NovelOperationJournal(f.storage, book).load()).toBeNull()
    expect(() => journal.save({ ...p, version: 2 })).toThrow()
    expect(() => journal.clear(book)).toThrow()
    journal.clear(mutation)
    expect(journal.load()).toBeNull()
  })
  it('存储失败明确失败；不可把非法目标或任意URL作为原处理恢复', () => {
    const f = setup()
    const journal = new NovelOperationJournal(
      {
        ...f.storage,
        setItem: () => {
          throw Error('quota')
        },
      },
      owner,
    )
    expect(() => journal.save(command())).toThrow()
    expect(journal.load()).toBeNull()
    expect(() => novelOperationPaths({ ...command(), book: 'https://example.test' })).toThrow()
  })
  it('原结果查询与原写入分开，错误目标和矛盾正式版本不能确认', () => {
    const p = command(),
      paths = novelOperationPaths(p)
    expect(paths.receipt).toBe(`/my/novels/${book}/publication-requests/${mutation}`)
    const result = {
      novel_id: book,
      mutation_id: mutation,
      submission_id: target,
      operation: 'review',
      state: 'published',
      version: 1,
    }
    expect(() => confirmNovelOperation(p, result)).not.toThrow()
    for (const v of [
      { ...result, submission_id: book },
      { ...result, version: 2 },
      { ...result, novel_id: owner },
      { ...result, state: 'pending' },
    ])
      expect(() => confirmNovelOperation(p, v)).toThrow()
  })
  it('原处置撤销的确认不能替代另一措施', () => {
    const p: NovelOperation = {
      ...command(),
      kind: 'case',
      target: '12',
      body: { mutation_id: mutation, decision: 'revoke', expected_revision: 2, reason: '纠错' },
    }
    expect(() =>
      confirmNovelOperation(p, {
        novel_id: book,
        operation: 'revoke',
        case_id: 12,
        id: 12,
        state: 'revoked',
        revision: 3,
      }),
    ).not.toThrow()
    expect(() =>
      confirmNovelOperation(p, {
        novel_id: book,
        operation: 'revoke',
        case_id: 13,
        id: 13,
        state: 'revoked',
        revision: 3,
      }),
    ).toThrow()
  })
})
