// Real author management components; deterministic service and DOM adapters only.
const esbuild = require("/tools/node_modules/esbuild");
const { chromium } = require("/tools/node_modules/playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
let stage = "bundle";
(async () => {
  const built = await esbuild.build({
    entryPoints: [path.join(__dirname, "entry.jsx")],
    bundle: true,
    write: false,
    define: {
      "process.env.EXPO_PUBLIC_API_URL": JSON.stringify(
        "http://127.0.0.1:3300/api",
      ),
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx", target: "ES2022" } },
    format: "esm",
    jsx: "automatic",
    loader: { ".png": "dataurl" },
    nodePaths: ["/app/node_modules"],
    plugins: [
      {
        name: "fixture",
        setup(build) {
          build.onResolve(
            { filter: /^react-native$|^react-native-safe-area-context$/ },
            () => ({
              path: path.join(__dirname, "native.jsx"),
            }),
          );
          build.onResolve({ filter: /^expo-router$/ }, () => ({
            path: path.join(__dirname, "router.jsx"),
          }));
          build.onResolve({ filter: /^react-native-svg$/ }, () => ({
            path: path.join(__dirname, "../mobile-versions-ui/svg.jsx"),
          }));
          build.onResolve({ filter: /\/auth\/context$/ }, () => ({
            path: path.join(__dirname, "context.jsx"),
          }));
          build.onResolve({ filter: /^expo-crypto$/ }, () => ({
            path: "crypto",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const randomUUID=()=>crypto.randomUUID();",
            loader: "js",
          }));
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true }),
    page = await browser.newPage();
  const id = "11111111-1111-4111-8111-111111111111",
    a = "22222222-2222-4222-8222-222222222222",
    b = "33333333-3333-4333-8333-333333333333";
  let state = {
    id,
    draft_id: a,
    display_version: 2,
    last_version: 2,
    state_revision: 1,
    author_hidden: false,
    history_open: false,
    platform_limited: false,
  };
  let drop = true,
    restricted = false,
    conflict = false,
    failRead = false,
    offline = false,
    managementRequests = 0;
  let catalogMode = false, catalogFail = false, pairFail = false, pairStateChange = false;
  const catalogRequests = [];
  const caseTime = '2026-10-01T00:00:00Z';
  let caseState = { id: 50, work_id: id, version: 1, scope: 'version', reason: '固定版本处置原因', state: 'active', revision: 1, created_at: caseTime, next_appeal_at: null };
  let appealDrop = true, appealReadFail = false, appealConflict = false;
  const appealAttempts = [], appealReceipts = new Map();
  let appealRows = Array.from({ length: 21 }, (_, n) => ({ id: 30 - n, case_id: 50, reason: '历史复核 ' + (30 - n), state: 'upheld', decision_reason: '历史维持说明', created_at: caseTime, decided_at: caseTime }));
  const receipts = new Map(),
    attempts = [],
    errors = [];
  let recoveryRead = null;
  let firstTimeline = true, releaseTimeline, markTimelineStarted;
  const timelineGate = new Promise(resolve => { releaseTimeline = resolve; });
  const timelineStarted = new Promise(resolve => { markTimelineStarted = resolve; });
  page.on("pageerror", (e) => errors.push(e.name));
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: { "X-Tako-Environment": "test" },
      body: JSON.stringify(body),
    });
  try {
    await page.route("**/__author", (route) =>
      route.fulfill({
        contentType: "text/html",
        body:
          '<div id="root"></div><script type="module">' +
          built.outputFiles[0].text.replaceAll("</script", "<\\/script") +
          "</script>",
      }),
    );
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        p = url.pathname,
        body = req.postDataJSON();
      const viewer = req.headers().authorization?.endsWith("b".repeat(64))
        ? b
        : a;
      if (p.startsWith('/api/my/moderation')) {
        if (viewer !== a) return p === '/api/my/moderation' ? json(route, { items: [], next: 0 }) : json(route, { error: 'resource_not_found' }, 404);
        if (p === '/api/my/moderation') return json(route, { items: [caseState], next: 0 });
        if (p !== '/api/my/moderation/50') return json(route, { error: 'resource_not_found' }, 404);
        if (req.method() === 'POST') {
          appealAttempts.push(body);
          if (appealReceipts.has(body.mutation_id)) { appealReadFail = true; return json(route, appealReceipts.get(body.mutation_id)); }
          if (appealConflict) return json(route, { error: 'appeal_cooldown' }, 409);
          const receipt = { id: 701, state: 'pending', revision: caseState.revision };
          appealReceipts.set(body.mutation_id, receipt);
          appealRows.unshift({ id: 701, case_id: 50, reason: body.reason, state: 'pending', decision_reason: '', created_at: caseTime, decided_at: null });
          if (appealDrop) { appealDrop = false; return route.abort(); }
          return json(route, receipt);
        }
        if (appealReadFail) { appealReadFail = false; return json(route, { error: 'internal_error' }, 500); }
        const before = Number(url.searchParams.get('before') || 0), rows = appealRows.filter(x => !before || x.id < before);
        return json(route, { case: caseState, appeals: { items: rows.slice(0, 20), next: rows.length > 20 ? rows[19].id : 0 }, work: { id, version: 1, title: '处置对应旧版', content: '处置固定正文并非工作稿', introduction: '', tags: ['日常'], author_nickname: '作者', published_at: caseTime }, revocation: caseState.state === 'revoked' ? { reason: '主动纠正这条处置', created_at: caseTime } : null });
      }
      if (p.startsWith("/api/my/works")) managementRequests++;
      if (offline) return route.abort();
      if (p === "/api/app/auth/login")
        return json(route, {
          account: {
            id: body.email.startsWith("b@") ? b : a,
            nickname: "作者",
          },
          token_type: "Bearer",
          expires_in: 604800,
          access_token:
            "tako_app_" + (body.email.startsWith("b@") ? "b" : "a").repeat(64),
        });
      if (p === "/api/app/auth/logout")
        return route.fulfill({
          status: 204,
          headers: { "X-Tako-Environment": "test" },
        });
      if (p === "/api/me") return json(route, { id: viewer, nickname: "作者" });
      if (p === "/api/my/works" && catalogMode && viewer === a) {
        const q = url.searchParams.get('q') ?? '', visibility = url.searchParams.get('visibility'), restriction = url.searchParams.get('restriction');
        const cursor = url.searchParams.get('cursor') ?? '';
        catalogRequests.push({ q, visibility, restriction, cursor });
        if (cursor && catalogFail) { catalogFail = false; return json(route, { error: 'internal_error' }, 500); }
        let items = Array.from({ length: 45 }, (_, n) => ({ ...state, id: n === 44 ? id : 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12, '0'), title: n === 44 ? '甲的正式作品' : '目录 ' + n, latest_title: n === 44 ? '甲的最新正式标题' : '目录 ' + n, display_limited: false, author_hidden: n === 44 ? state.author_hidden : false }));
        items = items.filter(x => (!q || (x.title + x.latest_title).toLowerCase().includes(q)) && (visibility === 'all' || x.author_hidden === (visibility === 'hidden')) && (restriction === 'all' || (x.platform_limited || x.display_limited) === (restriction === 'restricted')));
        const offset = cursor ? Number(cursor.slice(4)) : 0;
        return json(route, { items: items.slice(offset, offset + 20), next_cursor: offset + 20 < items.length ? 'page' + (offset + 20) : '' });
      }
      if (p === "/api/my/works")
        return json(route, {
          items: viewer === a ? [{ ...state, title: "甲的正式作品", latest_title: "甲的正式作品", display_limited: false }] : [],
          next_cursor: "",
        });
      if (/\/my\/works\/[^/]+\/versions\/[12]$/.test(p)) {
        const version = Number(p.split('/').at(-1));
        if (pairFail && version === 1) { return json(route, { error: 'internal_error' }, 500); }
        return json(route, { id, version, title: '核对正式标题' + version, content: '核对完整正文' + version + '\n中文😀结尾', introduction: '正式简介', tags: ['日常'], author_nickname: '作者', published_at: '2026-10-01T00:00:00Z' });
      }
      if (p.endsWith("/actions")) {
        attempts.push(body);
        if (receipts.has(body.mutation_id))
          return json(route, receipts.get(body.mutation_id));
        if (conflict) {
          conflict = false;
          state = { ...state, state_revision: state.state_revision + 1 };
          return json(route, { error: "work_state_conflict" }, 409);
        }
        state = {
          ...state,
          state_revision: state.state_revision + 1,
          ...(body.action === "hide"
            ? { author_hidden: true }
            : body.action === "restore"
              ? { author_hidden: false, display_version: body.version ?? 2 }
              : body.action === "set_history"
                ? { history_open: body.history_open }
                : { display_version: body.version }),
        };
        receipts.set(body.mutation_id, { ...state });
        if (drop) {
          drop = false;
          state.history_open = true;
          return route.abort();
        }
        return json(route, state);
      }
      if (p.endsWith("/versions")) {
        if (recoveryRead) { const gate = recoveryRead; recoveryRead = null; gate.started(); await gate.wait; }
        if (pairStateChange) { pairStateChange = false; state = { ...state, state_revision: state.state_revision + 1 }; }
        if (firstTimeline) {
          firstTimeline = false; markTimelineStarted(); await timelineGate;
        }
        if (failRead) {
          failRead = false;
          return json(route, { error: "service_unavailable" }, 503);
        }
        return json(route, {
          state,
          versions: [2, 1].map((version) => ({
            version,
            title: "私有版本" + version,
            published_at: "2026-11-02T00:00:00Z",
            platform_limited: restricted && version === 2,
            review_status: "pending",
          })),
          events: [],
          next_version_before: 0,
          next_event_before: 0,
        });
      }
      return json(route, { error: "resource_not_found" }, 404);
    });
    stage = "session-envelope";
    await page.goto("http://127.0.0.1:3300/__author");
    await page.getByRole("button", { name: "管理本人作品" }).click();
    await page.getByRole("button", { name: "管理作品 甲的正式作品" }).click();
    assert.equal(
      await page.evaluate(
        () => window.authorUi.session.snapshot().drafts.phase,
      ),
      "confirmation",
    );
    stage = "public-display-handoff";
    await timelineStarted;
    await page.getByText("正在读取作品状态", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "查看读者当前展示", exact: true }).count(), 0);
    releaseTimeline();
    await page.getByRole("button", { name: "查看读者当前展示", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "查看读者当前展示", exact: true }).count(), 1);
    await page.evaluate(() => { window.authorUi.holdNavigation = true; });
    await page.getByRole("button", { name: "查看读者当前展示", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.authorUi.lastPush), { pathname: "/works/[id]", params: { id } });
    await page.getByRole("button", { name: "修订发行这部作品", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.authorUi.lastPush), { pathname: "/publish", params: { work_id: id } });
    assert.equal(attempts.length, 0);
    state.platform_limited = true;
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await page.getByText("作者未隐藏 · 平台限制", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "查看读者当前展示", exact: true }).count(), 0);
    state.platform_limited = false;
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await page.getByRole("button", { name: "查看读者当前展示", exact: true }).waitFor();
    stage = "version-pair-read-and-race";
    pairFail = true;
    await page.getByRole('button', { name: '核对展示指针与 V1', exact: true }).click();
    await page.getByRole('button', { name: '重试核对读取', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '按候选 V1 确认展示切换', exact: true }).count(), 0);
    pairFail = false;
    await page.getByRole('button', { name: '重试核对读取', exact: true }).click();
    await page.getByRole('button', { name: '按候选 V1 确认展示切换', exact: true }).waitFor();
    await page.getByRole('button', { name: '展开当前指针版全文', exact: true }).click();
    await page.getByText('核对完整正文2\n中文😀结尾', { exact: true }).waitFor();
    await page.getByRole('button', { name: '展开候选版全文', exact: true }).click();
    await page.getByText('核对完整正文1\n中文😀结尾', { exact: true }).waitFor();
    assert.equal(attempts.length, 0);
    await page.getByRole('button', { name: '按候选 V1 确认展示切换', exact: true }).click();
    await page.getByRole('button', { name: '执行管理操作', exact: true }).waitFor();
    assert.equal(attempts.length, 0);
    await page.getByRole('button', { name: '取消操作', exact: true }).click();
    await page.getByRole('button', { name: '结束本次版本核对', exact: true }).click();
    pairStateChange = true;
    await page.getByRole('button', { name: '核对展示指针与 V1', exact: true }).click();
    await page.getByText('核对期间作品状态已变化。请先刷新管理状态，再重新选择候选版本。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '按候选 V1 确认展示切换', exact: true }).count(), 0);
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.waitForFunction(() => !document.body.textContent.includes('核对当前展示指针'));
    stage = "lost-response";
    await page.getByRole("button", { name: "隐藏作品", exact: true }).click();
    assert.equal(attempts.length, 0);
    await page.getByRole("button", { name: "执行管理操作" }).click();
    await page.getByRole("button", { name: "检查原管理操作" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "查看读者当前展示", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "修订发行这部作品", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.authorUi.blocked), true);
    await page.getByRole("button", { name: "检查原管理操作" }).click();
    await page
      .getByText("操作已确认，当前状态已重新读取。工作稿未修改。", {
        exact: true,
      })
      .waitFor();
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal(receipts.size, 1);
    assert.equal(await page.getByRole("button", { name: "查看读者当前展示", exact: true }).count(), 0);
    await page.getByRole("button", { name: "关闭历史正文" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "选择 V1 恢复公开" }).count(),
      0,
    );
    await page.getByRole("button", { name: "恢复公开并展示最新 V2" }).click();
    await page
      .getByText("将恢复公开并展示 V2；历史正文开放。", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "取消操作" }).click();
    stage = "restricted-restore";
    restricted = true;
    await page.getByRole("button", { name: "刷新状态" }).click();
    await page
      .getByText("最新版受限，请在下方明确选择正常旧版恢复。")
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "恢复公开并展示最新 V2" })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "选择 V1 恢复公开" }).click();
    await page
      .getByText("将恢复公开并展示 V1；历史正文开放。", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "取消操作" }).click();
    assert.equal(receipts.size, 1);
    stage = "version-pair-hidden-restore";
    await page.getByRole('button', { name: '核对展示指针与 V1', exact: true }).click();
    await page.getByRole('button', { name: '按候选 V1 确认恢复公开', exact: true }).click();
    await page.getByText('将恢复公开并展示 V1；历史正文开放。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '取消操作', exact: true }).click();
    await page.getByRole('button', { name: '结束本次版本核对', exact: true }).click();
    stage = "conflict";
    conflict = true;
    await page.getByRole("button", { name: "选择 V1 恢复公开" }).click();
    await page.getByRole("button", { name: "执行管理操作" }).click();
    await page
      .getByText("作品状态已变化，本次操作未执行。刷新后重新确认。", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "检查原管理操作" }).count(),
      0,
    );
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await page.getByRole("button", { name: "选择 V1 恢复公开" }).waitFor();
    stage = "read-failure";
    failRead = true;
    await page.getByRole("button", { name: "刷新状态" }).click();
    await page
      .getByText("暂时无法完成，请重试读取或检查原操作。", { exact: true })
      .waitFor();
    assert.equal(
      (await page.getByText("私有版本1", { exact: false }).count()) > 0,
      true,
    );
    stage = "confirmed-action-read-retry";
    failRead = true;
    await page.getByRole("button", { name: "选择 V1 恢复公开" }).click();
    await page.getByRole("button", { name: "执行管理操作" }).click();
    await page.getByText("操作已确认，暂时无法读取作品当前状态，请重试读取。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "检查原管理操作" }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "查看读者当前展示", exact: true }).count(), 0);
    const confirmedAttempts = attempts.length;
    const confirmedReceipts = receipts.size;
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await page.getByText("操作已确认，当前状态已重新读取。工作稿未修改。", { exact: true }).waitFor();
    assert.equal(attempts.length, confirmedAttempts);
    assert.equal(receipts.size, confirmedReceipts);
    assert.equal(await page.getByText("操作已确认，暂时无法读取作品当前状态，请重试读取。", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "查看读者当前展示", exact: true }).waitFor();
    failRead = true;
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await page.getByText("操作已确认，暂时无法读取作品当前状态，请重试读取。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "查看读者当前展示", exact: true }).isDisabled(), true);
    let releaseRecovery, markRecovery;
    const recoveryGate = new Promise(resolve => { releaseRecovery = resolve; });
    const recoveryStarted = new Promise(resolve => { markRecovery = resolve; });
    recoveryRead = { wait: recoveryGate, started: markRecovery };
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await recoveryStarted;
    // Clearing the old error is not completion of the new GET.
    assert.equal(await page.getByText("操作已确认，暂时无法读取作品当前状态，请重试读取。", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "查看读者当前展示", exact: true }).isDisabled(), true);
    assert.equal(attempts.length, confirmedAttempts);
    releaseRecovery();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '查看读者当前展示' && !button.disabled));
    assert.equal(await page.getByRole("button", { name: "查看读者当前展示", exact: true }).isEnabled(), true);
    assert.equal(attempts.length, confirmedAttempts);
    stage = "version-pair-restricted-read";
    await page.getByRole('button', { name: '核对展示指针与 V2', exact: true }).click();
    await page.getByText('候选或作品存在限制，或当前状态未确认；可核对本人内容，不能据此变更展示。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '按候选 V2 确认展示切换', exact: true }).count(), 0);
    await page.getByRole('button', { name: '展开候选版全文', exact: true }).click();
    await page.getByText('核对完整正文2\n中文😀结尾', { exact: true }).waitFor();
    await page.getByRole('button', { name: '结束本次版本核对', exact: true }).click();
    stage = "appeals-entry-and-history";
    await page.getByRole('button', { name: '返回作品列表', exact: true }).click();
    await page.evaluate(() => { window.authorUi.holdNavigation = false; });
    await page.getByRole('button', { name: '查看本人处置与复核', exact: true }).click();
    await page.getByRole('button', { name: '查看处置 #50', exact: true }).click();
    await page.getByText('处置原因：固定版本处置原因', { exact: true }).waitFor();
    await page.getByRole('button', { name: '查看对应正式正文', exact: true }).click();
    await page.getByText('处置固定正文并非工作稿', { exact: true }).waitFor();
    await page.getByRole('button', { name: '加载更多复核记录', exact: true }).click();
    await page.getByText('历史复核 10', { exact: true }).waitFor();
    assert.equal(appealAttempts.length, 0);
    stage = "appeals-unknown-and-confirmed-read";
    await page.getByRole('textbox', { name: '文字复核理由' }).fill('请核对固定版第三段');
    await page.getByRole('button', { name: '确认复核理由', exact: true }).click();
    assert.equal(appealAttempts.length, 0);
    await page.getByRole('button', { name: '提交这份复核申请', exact: true }).click();
    await page.getByRole('button', { name: '检查原复核申请', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '文字复核理由' }).isDisabled(), true);
    await page.getByRole('button', { name: '返回处置列表', exact: true }).click();
    await page.getByRole('dialog', { name: '复核内容尚在本页' }).waitFor();
    await page.getByRole('button', { name: '留在本页', exact: true }).click();
    await page.getByRole('button', { name: '检查原复核申请', exact: true }).click();
    await page.getByText('申请已确认，当前处置读取未完成。请重试读取，不会再次提交。', { exact: true }).waitFor();
    assert.deepEqual(appealAttempts[0], appealAttempts[1]);
    assert.equal(appealReceipts.size, 1);
    await page.getByRole('button', { name: '重新读取处置现状', exact: true }).click();
    await page.getByText('申请已确认，当前处置与复核记录已重新读取。', { exact: true }).waitFor();
    assert.equal(appealAttempts.length, 2);
    stage = "appeals-upheld-and-revoked";
    caseState = { ...caseState, revision: 2, next_appeal_at: '2099-01-01T00:00:00Z' };
    appealRows[0] = { ...appealRows[0], state: 'upheld', decision_reason: '维持本次处置', decided_at: caseTime };
    appealConflict = true;
    await page.getByRole('button', { name: '刷新处置', exact: true }).click();
    await page.getByText('结论理由：维持本次处置', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: '文字复核理由' }).fill('补充理由由服务端校验');
    await page.getByRole('button', { name: '确认复核理由', exact: true }).click();
    await page.getByRole('button', { name: '提交这份复核申请', exact: true }).click();
    await page.getByText('仍处于服务端24小时冷静期，请查看可再次申请时间。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '检查原复核申请', exact: true }).count(), 0);
    await page.getByRole('button', { name: '打开邮件应用联系运营', exact: true }).click();
    assert.equal(await page.evaluate(() => window.authorUi.lastContact), 'mailto:1125448766@qq.com');
    await page.evaluate(() => { window.authorUi.failContact = true; });
    await page.getByRole('button', { name: '打开邮件应用联系运营', exact: true }).click();
    await page.getByText('未能打开邮件应用，可复制上方邮箱自行联系。', { exact: true }).waitFor();
    caseState = { ...caseState, state: 'revoked', revision: 3 };
    await page.getByRole('button', { name: '刷新处置', exact: true }).click();
    await page.getByText('主动纠正这条处置', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认复核理由', exact: true }).count(), 0);
    await page.getByRole('button', { name: '返回处置列表', exact: true }).click();
    await page.getByRole('button', { name: '离开本页', exact: true }).click();
    await page.getByRole('button', { name: '返回作品管理', exact: true }).click();
    await page.getByRole('button', { name: '管理作品 甲的正式作品', exact: true }).click();
    await page.getByText('私有版本1', { exact: false }).first().waitFor();
    await page.evaluate(() => { window.authorUi.holdNavigation = true; });
    stage = "version-pair-decision";
    restricted = false;
    state = { ...state, state_revision: state.state_revision + 1 };
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await page.getByRole('button', { name: '核对展示指针与 V2', exact: true }).click();
    await page.getByRole('button', { name: '按候选 V2 确认展示切换', exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('author-blur')));
    await page.evaluate(() => window.dispatchEvent(new Event('author-focus')));
    await page.waitForFunction(() => !document.body.textContent.includes('核对当前展示指针'));
    await page.getByRole('button', { name: '核对展示指针与 V2', exact: true }).click();
    await page.getByRole('button', { name: '按候选 V2 确认展示切换', exact: true }).click();
    const beforeDecision = attempts.length;
    await page.getByRole('button', { name: '执行管理操作', exact: true }).click();
    await page.getByText('操作已确认，当前状态已重新读取。工作稿未修改。', { exact: true }).waitFor();
    assert.equal(attempts.length, beforeDecision + 1);
    assert.equal(attempts.at(-1).action, 'switch_display'); assert.equal(attempts.at(-1).version, 2);
    assert.equal(state.display_version, 2);
    assert.equal(await page.getByRole('button', { name: '展开候选版全文', exact: true }).count(), 0);
    stage = "catalog-search-and-paging";
    await page.getByRole('button', { name: '返回作品列表', exact: true }).click();
    catalogMode = true;
    await page.getByRole('button', { name: '刷新作品', exact: true }).click();
    await page.getByText(/已读取 20 件/).waitFor();
    const beforeEditing = catalogRequests.length;
    await page.getByRole('textbox', { name: '作品标题关键词' }).fill('甲的最新');
    assert.equal(catalogRequests.length, beforeEditing);
    assert.equal(await page.getByRole('button', { name: '加载更多作品', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '查找作品', exact: true }).click();
    await page.getByText('最新正式标题：甲的最新正式标题', { exact: true }).waitFor();
    assert.equal(catalogRequests.at(-1).q, '甲的最新');
    await page.getByRole('button', { name: '清空条件', exact: true }).click();
    await page.getByText(/已读取 20 件/).waitFor();
    catalogFail = true;
    await page.getByRole('button', { name: '加载更多作品', exact: true }).click();
    await page.getByRole('button', { name: '重试加载更多作品', exact: true }).click();
    await page.getByText(/已读取 40 件/).waitFor();
    await page.getByRole('button', { name: '加载更多作品', exact: true }).click();
    await page.getByText(/已读取 45 件/).waitFor();
    stage = "catalog-management-return";
    await page.getByRole('button', { name: '作者未隐藏', exact: true }).click();
    await page.getByRole('textbox', { name: '作品标题关键词' }).fill('甲的最新');
    await page.getByRole('button', { name: '查找作品', exact: true }).click();
    await page.getByRole('button', { name: '管理作品 甲的正式作品', exact: true }).click();
    await page.getByRole('button', { name: '隐藏作品', exact: true }).click();
    await page.getByRole('button', { name: '执行管理操作', exact: true }).click();
    await page.getByText('操作已确认，当前状态已重新读取。工作稿未修改。', { exact: true }).waitFor();
    const afterHideAttempts = attempts.length;
    await page.getByRole('button', { name: '返回作品列表', exact: true }).click();
    await page.getByText('没有符合条件的作品', { exact: true }).waitFor();
    assert.equal(catalogRequests.at(-1).visibility, 'shown');
    assert.equal(catalogRequests.at(-1).q, '甲的最新');
    assert.equal(attempts.length, afterHideAttempts);
    await page.getByRole('button', { name: '作者已隐藏', exact: true }).click();
    await page.getByRole('button', { name: '查找作品', exact: true }).click();
    await page.getByRole('button', { name: '管理作品 甲的正式作品', exact: true }).click();
    await page.getByText('私有版本1', { exact: false }).first().waitFor();
    stage = "catalog-revision-return";
    await page.getByRole('button', { name: '修订发行这部作品', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('author-blur')));
    await page.evaluate(() => window.dispatchEvent(new Event('author-focus')));
    await page.getByRole('button', { name: '管理作品 甲的正式作品', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '作品标题关键词' }).inputValue(), '甲的最新');
    assert.equal(catalogRequests.at(-1).visibility, 'hidden');
    assert.equal(attempts.length, afterHideAttempts);
    await page.getByRole('button', { name: '管理作品 甲的正式作品', exact: true }).click();
    await page.getByText('私有版本1', { exact: false }).first().waitFor();
    catalogMode = false;
    stage = "offline-grant-blocks-management";
    await page.evaluate(() => window.authorUi.session.confirmDraftAccess());
    const beforeOfflineRequests = managementRequests;
    const beforeOfflineAttempts = attempts.length;
    offline = true;
    await page.evaluate(() => window.authorUi.session.restore());
    await page.getByText("连接后确认账号", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.authorUi.session.snapshot().drafts.phase,
      ),
      "offline",
    );
    assert.equal(
      await page.getByText("私有版本1", { exact: false }).count(),
      0,
    );
    assert.equal(managementRequests, beforeOfflineRequests);
    assert.equal(attempts.length, beforeOfflineAttempts);
    stage = "online-grant-restores-management";
    offline = false;
    await page.getByRole("button", { name: "重试确认账号" }).click();
    await page.getByRole("button", { name: "管理作品 甲的正式作品" }).click();
    await page.getByText("私有版本1", { exact: false }).first().waitFor();
    assert.equal(attempts.length, beforeOfflineAttempts);
    stage = "account-switch";
    await page.getByRole('button', { name: '返回作品列表', exact: true }).click();
    await page.evaluate(() => { window.authorUi.holdNavigation = false; });
    await page.getByRole('button', { name: '查看本人处置与复核', exact: true }).click();
    await page.getByRole('button', { name: '查看处置 #50', exact: true }).click();
    await page.getByRole('button', { name: '查看对应正式正文', exact: true }).click();
    await page.getByText('处置固定正文并非工作稿', { exact: true }).waitFor();
    await page.evaluate(async () => {
      await window.authorUi.session.logout();
      await window.authorUi.session.signIn(
        "login",
        "b@example.test",
        "fixture-password",
      );
    });
    await page.getByText('没有处置记录', { exact: true }).waitFor();
    assert.equal(await page.getByText('处置固定正文并非工作稿', { exact: true }).count(), 0);
    await page.getByRole('button', { name: '返回作品管理', exact: true }).click();
    await page.getByText("还没有正式作品", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.authorUi.session.snapshot().drafts.phase,
      ),
      "confirmation",
    );
    assert.equal(
      await page.getByText("私有版本1", { exact: false }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS author component fixtures: session envelope and pending draft confirmation preserve server management, offline draft grant hides management without requests, online read-only restoration, real entry, confirmation, uncertain retry, fresh state, restricted restore, cancellation, conflict, read failure and account isolation.",
    );
  } catch (error) {
    console.error("Author fixture failed at " + stage + ": " + error.name);
    console.error("Author fixture locations: " + [...String(error.stack).matchAll(/run\.cjs:(\d+):(\d+)/g)].slice(0, 3).map(x => x[1] + ":" + x[2]).join(","));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(() => {
  console.error("Author fixture dependency or bundle failure");
  process.exitCode = 1;
});
