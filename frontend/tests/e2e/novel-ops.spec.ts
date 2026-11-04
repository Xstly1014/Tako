import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
const owner = '11111111-1111-4111-8111-111111111111',
  other = '99999999-9999-4999-8999-999999999999',
  book = '22222222-2222-4222-8222-222222222222',
  chapter = '55555555-5555-4555-8555-555555555555',
  submission = '33333333-3333-4333-8333-333333333333',
  preview = '77777777-7777-4777-8777-777777777777',
  draft = '88888888-8888-4888-8888-888888888888',
  now = '2026-11-03T00:00:00Z'
async function fixture(page: Page, operator = true) {
  const f = {
    actor: owner,
    operator,
    writes: [] as { path: string; body: Record<string, unknown> }[],
    receipt: null as Record<string, unknown> | null,
    drop: true,
    failQueue: false,
    published: false,
    queueReads: 0,
    caseActive: true,
  }
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname
    const reply = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    const error = (code: string, status: number) =>
      reply({ error: code, request_id: owner }, status)
    if (p === '/api/me') return reply({ id: f.actor, nickname: '运营测试' })
    if (p === '/api/me/access') return reply({ operator: f.operator })
    if (!f.operator) return error('operator_required', 403)
    if (p.includes('/author-policy')) {
      if (req.method() === 'POST') {
        const body = req.postDataJSON()
        f.writes.push({ path: p, body })
        f.receipt = {
          context_id: book,
          context_kind: 'novel',
          mutation_id: body.mutation_id,
          action: body.action,
          revision: Number(body.expected_revision) + 1,
          reason: body.reason,
          previous_until: null,
          observation_until: '2026-11-11T00:00:00Z',
          created_at: now,
        }
        if (f.drop) {
          f.drop = false
          return route.abort()
        }
        return reply(f.receipt)
      }
      if (p.includes('/requests/'))
        return f.receipt ? reply(f.receipt) : error('resource_not_found', 404)
      return reply({
        policy: { revision: 0, active: false, observation_until: null, reason: '' },
        items: [],
        next: 0,
      })
    }
    const formal = {
      novel_id: book,
      state_revision: 3,
      author_hidden: true,
      platform_limited: true,
      completed: false,
      last_position: 1,
      formal: {
        title: '合成测试书籍',
        introduction: '用于运营页面验收的合成资料。',
        tags: ['幻想'],
        revision: 1,
        first_published_at: now,
        updated_at: now,
      },
      metadata_submission_id: null,
    }
    const c = {
      id: 12,
      novel_id: book,
      target_id: book,
      scope: 'book',
      version: 0,
      reason: '合成资料处置原因',
      state: f.caseActive ? 'active' : 'revoked',
      revision: f.caseActive ? 1 : 2,
      created_at: now,
      next_appeal_at: null,
      decision_reason: '',
    }
    const appeal = {
      novel_id: book,
      id: 99,
      case_id: 12,
      reason: '合成作者的复核说明',
      state: 'pending',
      decision_reason: '',
      created_at: now,
      decided_at: null,
    }
    if (p === '/api/ops/novels/chapter-review-queue') {
      f.queueReads++
      if (f.failQueue) {
        f.failQueue = false
        return error('service_unavailable', 503)
      }
      return reply({
        items: f.published
          ? []
          : [
              {
                id: submission,
                novel_id: book,
                chapter_id: chapter,
                preview_id: preview,
                title: '合成第一章',
                ordinal: 1,
                candidate_version: 1,
                state: 'pending',
                current: true,
                reason: '',
                submitted_at: now,
                decided_at: null,
              },
            ],
        next_cursor: '',
      })
    }
    if (p === `/api/ops/novels/${book}/chapter-submissions/${submission}`)
      return reply({
        submission: {
          id: submission,
          novel_id: book,
          chapter_id: chapter,
          preview_id: preview,
          title: '合成第一章',
          ordinal: 1,
          candidate_version: 1,
          state: f.published ? 'published' : 'pending',
          current: !f.published,
          reason: '',
          submitted_at: now,
          decided_at: f.published ? now : null,
        },
        preview: {
          id: preview,
          novel_id: book,
          chapter_id: chapter,
          draft_id: draft,
          source_revision: 1,
          title: '合成第一章',
          content: '这是合成章节正文。\n固定内容与工作稿分开。',
          book_title: '合成测试书籍',
          introduction: '测试简介',
          tags: ['幻想'],
          ordinal: 1,
          reserved: false,
          expected_last_position: 0,
          expected_version: 0,
          candidate_version: 1,
          review_required: true,
          book_hidden: true,
          chapter_hidden: false,
          restricted: false,
          expires_at: now,
        },
      })
    if (p === `/api/ops/novels/${book}/formal-state`) return reply(formal)
    if (
      p === `/api/ops/novels/${book}/chapter-submissions/${submission}/review` &&
      req.method() === 'POST'
    ) {
      const body = req.postDataJSON()
      f.writes.push({ path: p, body })
      f.published = true
      f.receipt = {
        mutation_id: body.mutation_id,
        operation: 'review',
        novel_id: book,
        chapter_id: chapter,
        preview_id: preview,
        submission_id: submission,
        ordinal: 1,
        state: 'published',
        version: 1,
        accepted_at: now,
      }
      if (f.drop) return route.abort()
      return reply(f.receipt)
    }
    if (p.startsWith(`/api/my/novels/${book}/publication-requests/`))
      return f.receipt ? reply(f.receipt) : error('resource_not_found', 404)
    if (p === '/api/ops/novels/moderation') return reply({ items: [c], next: 0 })
    if (p === '/api/ops/novels/appeals')
      return reply({ items: f.caseActive ? [appeal] : [], next: 0 })
    if (p === `/api/ops/novels/${book}/moderation/12`) {
      if (req.method() === 'GET')
        return reply({ case: c, appeals: { items: f.caseActive ? [appeal] : [], next: 0 } })
      const body = req.postDataJSON()
      f.writes.push({ path: p, body })
      f.caseActive = false
      return reply({
        operation: 'revoke',
        novel_id: book,
        case_id: 12,
        id: 12,
        state: 'revoked',
        revision: 2,
      })
    }
    if (p === '/api/ops/novels/post-reviews' || p === '/api/ops/novels/metadata-review-queue')
      return reply({ items: [], next_cursor: '' })
    return error('resource_not_found', 404)
  })
  return f
}
async function selectChapter(page: Page) {
  await page.goto('/ops/novels')
  await page.locator('.queue-row').first().click()
  await expect(page.getByRole('heading', { name: '合成第一章', exact: true })).toBeVisible()
}
async function approve(page: Page) {
  await page.getByRole('button', { name: '核对本次处理', exact: true }).click()
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
}

test('章节处理丢响应后重开只读确认，确认后刷新失败不重发', async ({ page }) => {
  const f = await fixture(page)
  await selectChapter(page)
  await page.getByText('查看固定内容', { exact: true }).click()
  await expect(page.locator('.fixed-text')).toContainText('固定内容与工作稿分开。')
  await approve(page)
  await expect(page.getByRole('heading', { name: '原处理尚未确认' })).toBeVisible()
  expect(f.writes.length).toBe(1)
  await page.reload()
  await expect(page.getByText('存在未确认的原处理，请先查询结果。', { exact: true })).toBeVisible()
  f.failQueue = true
  await page.getByRole('button', { name: '查询原结果', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('处理已确认，队列暂时读取失败。')
  expect(f.writes.length).toBe(1)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.getByText('暂无记录。', { exact: true })).toBeVisible()
  expect(f.writes.length).toBe(1)
})
test('存储失败不发处理，普通账号不读取运营队列', async ({ page }) => {
  const f = await fixture(page)
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('test', 'QuotaExceededError')
    }
  })
  await selectChapter(page)
  await approve(page)
  await expect(page.getByRole('status')).toContainText('请求未发出')
  expect(f.writes.length).toBe(0)
  f.operator = false
  await page.reload()
  await expect(page.getByRole('status')).toContainText('当前账号没有运营权限')
  expect(f.writes.length).toBe(0)
})
test('处置记录与复核入口可返回，撤销明确措施而非改正文', async ({ page }) => {
  const f = await fixture(page)
  f.drop = false
  await page.goto('/ops/novels')
  await page.getByRole('button', { name: '待复核', exact: true }).click()
  await page.locator('.queue-row').first().click()
  await expect(page.getByText('合成作者的复核说明', { exact: true })).toBeVisible()
  await page.getByLabel('处理方式').selectOption('revoke')
  await page.getByLabel('处理原因').fill('合成纠错原因')
  const folder = path.resolve('../.runtime/novel-ops')
  mkdirSync(folder, { recursive: true })
  await page.screenshot({ path: path.join(folder, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('body')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: path.join(folder, 'mobile.png'), fullPage: true })
  await approve(page)
  await expect(page.getByRole('status')).toContainText('处理已确认')
  expect(f.writes.length).toBe(1)
  expect(f.writes[0]!.body).toMatchObject({
    decision: 'revoke',
    expected_revision: 1,
    appeal_id: 99,
  })
  await expect(page.getByRole('link', { name: '中篇内容治理', exact: true })).toHaveAttribute(
    'href',
    '/ops/reviews',
  )
})
test('换账号隐藏旧内容和旧待确认操作，不转交原处理', async ({ page }) => {
  const f = await fixture(page)
  await selectChapter(page)
  await page.getByLabel('处理原因').fill('旧运营账号的合成原因')
  await approve(page)
  await expect(page.getByRole('heading', { name: '原处理尚未确认' })).toBeVisible()
  f.actor = other
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('status')).toContainText('会话已变化')
  await expect(page.locator('.fixed-text')).toHaveCount(0)
  await page.getByRole('button', { name: '重新验证登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '原处理尚未确认' })).toHaveCount(0)
  expect(f.writes.length).toBe(1)
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key) !== null,
      `tako-novel-operations-v1:${owner}`,
    ),
  ).toBe(true)
})

test('账号观察期明确作用范围，丢响应重开只查原决定', async ({ page }) => {
  const f = await fixture(page)
  await selectChapter(page)
  await page.getByText('作者账号观察期', { exact: true }).click()
  await page.getByRole('button', { name: '读取作者观察期', exact: true }).click()
  await expect(page.getByText('当前不在观察期', { exact: false })).toBeVisible()
  await page.getByLabel('本次决定原因').fill('再次核对后明确决定观察')
  await page.getByRole('button', { name: '开始7天观察期', exact: true }).click()
  await expect(
    page.getByText(
      '本次作用于作者账号，影响之后的中篇与长文提交；既有待审继续人工审核，既有公开内容不自动隐藏。',
      { exact: true },
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: '确认执行', exact: true }).click()
  await expect(page.getByRole('heading', { name: '原处理尚未确认' })).toBeVisible()
  expect(f.writes.length).toBe(1)
  await page.reload()
  await page.getByRole('button', { name: '查询原结果', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('处理已确认')
  expect(f.writes.length).toBe(1)
  expect(f.writes[0]!.body).toMatchObject({
    action: 'start',
    expected_revision: 0,
    reason: '再次核对后明确决定观察',
  })
})
