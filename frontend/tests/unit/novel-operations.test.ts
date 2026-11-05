import { describe, it, expect } from 'vitest'
import {
  NovelOperationJournal,
  checkedNovelOperation,
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

it('账号观察期原操作使用指定书与原mutation确认，不用当前状态代替回执', () => {
  const p: NovelOperation = {
    owner,
    book,
    target: book,
    kind: 'policy',
    version: 0,
    body: {
      mutation_id: mutation,
      action: 'extend',
      expected_revision: 2,
      reason: '再次确认违规延长',
    },
  }
  expect(novelOperationPaths(p)).toEqual({
    write: `/ops/novels/${book}/author-policy`,
    receipt: `/ops/novels/${book}/author-policy/requests/${mutation}`,
  })
  const result = {
    context_id: book,
    context_kind: 'novel',
    mutation_id: mutation,
    action: 'extend',
    revision: 3,
    reason: '再次确认违规延长',
    created_at: '2026-11-04T00:00:00Z',
    previous_until: '2026-11-11T00:00:00Z',
    observation_until: '2026-11-18T00:00:00Z',
  }
  expect(() => confirmNovelOperation(p, result)).not.toThrow()
  for (const v of [
    { ...result, revision: 4 },
    { ...result, mutation_id: target },
    { ...result, action: 'start' },
    { ...result, observation_until: null },
    { ...result, context_id: owner },
  ])
    expect(() => confirmNovelOperation(p, v)).toThrow()
  const { storage } = setup(),
    journal = new NovelOperationJournal(storage, owner)
  journal.save(p)
  expect(journal.load()).toEqual(p)
  expect(new NovelOperationJournal(storage, book).load()).toBeNull()
})

it('中篇先审与撤回回执不接受另一目标或虚假正式版本', () => {
  const p: NovelOperation = {
    owner,
    book,
    target,
    kind: 'work-pre',
    version: 2,
    body: { mutation_id: mutation, decision: 'approve', reason: '' },
  }
  const result = {
    mutation_id: mutation,
    work_id: book,
    submission_id: target,
    state: 'published',
    version: 2,
  }
  expect(novelOperationPaths(p).write).toBe(`/ops/work-submissions/${target}/review`)
  expect(() => confirmNovelOperation(p, result)).not.toThrow()
  expect(() => confirmNovelOperation(p, { ...result, version: 3 })).toThrow()
  const withdraw: NovelOperation = {
    ...p,
    kind: 'work-withdraw',
    version: 0,
    body: { mutation_id: mutation },
  }
  expect(novelOperationPaths(withdraw).receipt).toBe(`/work-submission-requests/${mutation}`)
  expect(() =>
    confirmNovelOperation(withdraw, { ...result, state: 'withdrawn', version: 0 }),
  ).not.toThrow()
  expect(() => confirmNovelOperation(withdraw, result)).toThrow()
})

it('binds rectification actions to the exact original command, rejects draft text and wrong revision', () => {
  for (const kind of ['rect-grant', 'rect-approve', 'rect-reject', 'rect-cancel'] as const) {
    const p: NovelOperation = {
      owner,
      book,
      kind,
      target,
      version: 2,
      body:
        kind === 'rect-grant'
          ? {
              mutation_id: mutation,
              chapter_id: target,
              base_version: 2,
              case_id: 7,
              case_revision: 1,
              reason: '指定章整改',
            }
          : {
              mutation_id: mutation,
              expected_revision: 2,
              reason: '人工核对',
              revoke_case: kind === 'rect-approve',
            },
    }
    checkedNovelOperation(p, owner)
    const paths = novelOperationPaths(p)
    expect(paths.receipt).toBe(`/ops/novels/${book}/lifecycle-requests/${mutation}`)
    const receipt = {
      mutation_id: mutation,
      operation: 'rectification_' + kind.slice(5),
      novel_id: book,
      target_id: target,
      state:
        kind === 'rect-grant'
          ? 'available'
          : kind === 'rect-approve'
            ? 'approved'
            : kind === 'rect-reject'
              ? 'rejected'
              : 'cancelled',
      revision: kind === 'rect-grant' ? 1 : 3,
      version: kind === 'rect-approve' ? 3 : 0,
      accepted_at: new Date().toISOString(),
    }
    confirmNovelOperation(p, receipt)
    expect(() => confirmNovelOperation(p, { ...receipt, revision: 99 })).toThrow()
    expect(() =>
      checkedNovelOperation({ ...p, body: { ...p.body, content: 'private fixed text' } }, owner),
    ).toThrow()
    if (kind !== 'rect-grant')
      expect(() => confirmNovelOperation(p, { ...receipt, target_id: book })).toThrow()
    if (kind === 'rect-reject')
      expect(() =>
        checkedNovelOperation({ ...p, body: { ...p.body, revoke_case: true } }, owner),
      ).toThrow()
  }
})
