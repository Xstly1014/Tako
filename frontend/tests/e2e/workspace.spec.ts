import { test, expect, type Page } from '@playwright/test'

const alice = '932af8a8-0bf8-441d-b132-e4c67fd05fa7'
const bob = '755d4049-f0c9-43af-97fb-baf349a6c302'
const source = '33624550-634e-47a4-9050-5dc7137587b4'
type Draft = {
  id: string
  owner: string
  title: string
  content: string
  revision: number
  saved_at: string
}
async function fixture(page: Page, loggedIn = true) {
  const state = { account: loggedIn ? alice : '', network: true, copies: 0, crossAccountWrites: 0 }
  const records = new Map<string, Draft>([
    [
      source,
      {
        id: source,
        owner: alice,
        title: '风吹过的地方',
        content: '最初的文字。',
        revision: 1,
        saved_at: '2026-10-29T10:00:00Z',
      },
    ],
  ])
  const requests = new Map<string, { draft_id: string; revision: number; saved_at: string }>()
  // These are browser-only protocol fixtures. No test request sends real email.
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      body = req.postDataJSON() ?? {}
    if (!state.network) {
      await route.abort('internetdisconnected')
      return
    }
    const reply = (status: number, value: unknown) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (path === '/api/auth/code')
      return reply(202, {
        delivery_id: body.delivery_id,
        status: 'queued',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      })
    if (path === '/api/auth/verify') {
      state.account = body.email.startsWith('bob') ? bob : alice
      return reply(200, {
        id: state.account,
        nickname: state.account === alice ? '作者甲' : '作者乙',
      })
    }
    if (path === '/api/auth/logout') {
      state.account = ''
      return route.fulfill({ status: 204 })
    }
    if (!state.account)
      return reply(401, {
        error: 'authentication_required',
        request_id: '706dbf1e-f6c6-4f16-a40b-f4360e199ac8',
      })
    if (path === '/api/me')
      return reply(200, {
        id: state.account,
        nickname: state.account === alice ? '作者甲' : '作者乙',
      })
    if (path === '/api/drafts' && req.method() === 'GET')
      return reply(200, {
        items: [...records.values()]
          .filter((row) => row.owner === state.account)
          .map(({ content: _content, owner: _owner, ...row }) => ({
            ...row,
            created_at: row.saved_at,
            recovered_from: null,
          })),
        next_cursor: '',
      })
    if (path === '/api/drafts/create') {
      let ack = requests.get(body.mutation_id)
      if (!ack) {
        const id = crypto.randomUUID()
        const row: Draft = {
          id,
          owner: state.account,
          title: body.title,
          content: body.content,
          revision: 1,
          saved_at: new Date().toISOString(),
        }
        records.set(id, row)
        ack = { draft_id: id, revision: 1, saved_at: row.saved_at }
        requests.set(body.mutation_id, ack)
      }
      return reply(200, ack)
    }
    if (path === '/api/drafts/save' || path === '/api/drafts/recover') {
      const parent = records.get(body.draft_id)
      if (!parent || parent.owner !== state.account) {
        state.crossAccountWrites++
        return reply(404, { error: 'draft_not_found' })
      }
      const previous = requests.get(body.mutation_id)
      if (previous) return reply(200, previous)
      if (path.endsWith('/save') && body.base_revision !== parent.revision)
        return reply(409, { error: 'revision_conflict' })
      const id = path.endsWith('/recover') ? crypto.randomUUID() : parent.id
      const row: Draft = {
        id,
        owner: state.account,
        title: body.title,
        content: body.content,
        revision: id === parent.id ? parent.revision + 1 : 1,
        saved_at: new Date().toISOString(),
      }
      records.set(id, row)
      if (id !== parent.id) state.copies++
      const ack = { draft_id: id, revision: row.revision, saved_at: row.saved_at }
      requests.set(body.mutation_id, ack)
      return reply(200, ack)
    }
    if (path.startsWith('/api/drafts/')) {
      const row = records.get(path.split('/').at(-1)!)
      if (!row || row.owner !== state.account) return reply(404, { error: 'draft_not_found' })
      const { owner: _owner, ...visible } = row
      return reply(200, visible)
    }
    await route.abort() // Unhandled API operations must never reach production services.
  })
  return { state, records }
}
async function signIn(page: Page, email = 'alice@example.test') {
  await page.getByLabel('邮箱', { exact: true }).fill(email)
  await page.getByLabel('验证码', { exact: true }).fill('123456')
  await page.getByRole('button', { name: '进入写作空间', exact: true }).click()
}
async function openFirst(page: Page) {
  await page.locator('.draft-sidebar .draft-item').first().click()
  await expect(page.getByLabel('草稿正文')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  ;(page as Page & { browserErrors?: string[] }).browserErrors = errors
})
test.afterEach(async ({ page }) => {
  expect((page as Page & { browserErrors?: string[] }).browserErrors).toEqual([])
})

test('real public shell and anonymous login do not need a mail bypass', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('都可以开写')
  await page.locator('.mascot-image').evaluate((image: HTMLImageElement) => image.decode())
  await page.screenshot({ path: 'test-results/landing.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/mobile-landing.png', fullPage: true })
  await page.goto('/workspace')
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
})
test('queued mail is not presented as delivered, and login uses API', async ({ page }) => {
  await fixture(page, false)
  await page.goto('/workspace')
  await page.getByLabel('邮箱', { exact: true }).fill('alice@example.test')
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('不代表邮件已送达')
  await signIn(page)
  await expect(page.locator('.draft-sidebar')).toBeVisible()
})
test('saves text and reopens it after reload', async ({ page }) => {
  const { records } = await fixture(page)
  await page.goto('/workspace')
  await openFirst(page)
  await page.getByLabel('草稿正文').fill('写下的新文字，刷新后也还在。')
  await page.getByRole('button', { name: '立即同步' }).click()
  await expect.poll(() => records.get(source)?.content).toBe('写下的新文字，刷新后也还在。')
  await page.reload()
  await openFirst(page)
  await expect(page.getByLabel('草稿正文')).toHaveValue('写下的新文字，刷新后也还在。')
  await page.screenshot({ path: 'test-results/workspace.png', fullPage: true })
})
test('keeps disconnected input through reload and later resynchronizes', async ({ page }) => {
  const { state, records } = await fixture(page)
  await page.goto('/workspace')
  await openFirst(page)
  state.network = false
  await page.getByLabel('草稿正文').fill('断网期间写下的内容。')
  await expect(page.getByRole('status')).toContainText('本机')
  state.network = true
  await page.reload()
  await expect
    .poll(() => records.get(source)?.content, { timeout: 20_000 })
    .toBe('断网期间写下的内容。')
})
test('preserves both versions by recovering, not overwriting', async ({ page }) => {
  const { state, records } = await fixture(page)
  await page.goto('/workspace')
  await openFirst(page)
  records.set(source, { ...records.get(source)!, content: '另一设备的版本', revision: 2 })
  await page.getByLabel('草稿正文').fill('当前页面的独立版本')
  await page.getByRole('button', { name: '立即同步' }).click()
  await expect.poll(() => state.copies).toBe(1)
  expect(records.get(source)?.content).toBe('另一设备的版本')
  await expect(page.getByLabel('草稿正文')).toHaveValue('当前页面的独立版本')
})
test('logout preserves local data but does not expose or send it to another account', async ({
  page,
}) => {
  const { state, records } = await fixture(page)
  await page.goto('/workspace')
  await openFirst(page)
  state.network = false
  await page.getByLabel('草稿正文').fill('甲账号未同步的私密文字')
  await expect(page.getByRole('status')).toContainText('本机')
  await page.getByRole('button', { name: '退出登录' }).click()
  state.network = true
  await signIn(page, 'bob@example.test')
  await expect(page.getByText('甲账号未同步的私密文字', { exact: true })).toHaveCount(0)
  expect(state.crossAccountWrites).toBe(0)
  await page.getByRole('button', { name: '退出登录' }).click()
  await signIn(page)
  await expect
    .poll(() => records.get(source)?.content, { timeout: 20_000 })
    .toBe('甲账号未同步的私密文字')
})
test('storage unavailable degrades explicitly while server saving still works', async ({
  page,
}) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException('storage blocked', 'SecurityError')
    }
  })
  const { records } = await fixture(page)
  await page.goto('/workspace')
  await expect(page.getByRole('alert')).toContainText('浏览器本机存储不可用')
  await openFirst(page)
  await page.getByLabel('草稿正文').fill('内存降级仍可服务端保存')
  await page.getByRole('button', { name: '立即同步' }).click()
  await expect.poll(() => records.get(source)?.content).toBe('内存降级仍可服务端保存')
})
test('mobile viewport keeps editing and export within the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await fixture(page)
  await page.goto('/workspace')
  await openFirst(page)
  await expect(page.getByRole('button', { name: '导出文字' })).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-workspace.png', fullPage: true })
})


test('expired session keeps editing and uses compact login without a brand panel', async ({ page }) => {
  const { state, records } = await fixture(page)
  await page.goto('/workspace')
  await openFirst(page)
  state.account = ''
  await page.getByLabel('草稿正文').fill('登录过期期间继续编辑的文字')
  await page.getByRole('button', { name: '立即同步' }).click()
  await expect(page.locator('.auth-shell--compact')).toBeVisible()
  await expect(page.locator('.auth-art')).toHaveCount(0)
  await expect(page.locator('.auth-mobile-mascot')).toHaveCount(0)
  await expect(page.getByLabel('草稿正文')).toHaveValue('登录过期期间继续编辑的文字')
  await signIn(page)
  await expect.poll(() => records.get(source)?.content, { timeout: 20_000 })
    .toBe('登录过期期间继续编辑的文字')
})
