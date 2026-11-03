// Real application components, real API/MySQL; only platform/navigation adapters.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const esbuild = require("/tools/node_modules/esbuild"),
  { chromium } = require("/tools/node_modules/playwright");
const { randomUUID } = require("node:crypto");
let stage = "bundle";
const fixture = JSON.parse(
  fs.readFileSync(process.env.WORKFLOW_FIXTURE, "utf8"),
);
const apiBase = "http://api:8080/api";
async function api(route, token = "", body, method = body ? "POST" : "GET") {
  const response = await fetch(apiBase + route, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (response.headers.get("X-Tako-Environment") !== "test")
    throw Error("environment");
  if (response.status === 204) return;
  const value = await response.json();
  if (!response.ok) {
    const error = Error("api_rejected");
    error.code = value.error;
    throw error;
  }
  return value;
}
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
        name: "platform-adapters",
        setup(build) {
          for (const [filter, target] of [
            [/^react-native$|^react-native-safe-area-context$/, "native.jsx"],
            [/^expo-router$/, "router.jsx"],
            [/^react-native-svg$/, "../mobile-versions-ui/svg.jsx"],
            [/^expo-secure-store$/, "../mobile-publication-ui/store.jsx"],
            [/\/auth\/context$/, "../mobile-author-works-ui/context.jsx"],
          ])
            build.onResolve({ filter }, () => ({
              path: path.join(__dirname, target),
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
  const errors = [],
    writes = [],
    requests = [];
  let dropPublication = true,
    publications = 0,
    workID = "",
    operatorToken = "";
  const active = () =>
    page.locator("section[data-workflow-page]:not([hidden])");
  const button = (label) =>
    active().getByRole("button", { name: label, exact: true });
  const text = (value) => active().getByText(value, { exact: true });
  try {
    // Native auth deliberately rejects browser Origin/ambient Cookie. The DOM
    // adapter must model native fetch, never relax this service protection.
    const originAttempt = await fetch(apiBase + "/app/auth/login", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3300",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fixture.author),
    });
    assert.equal(originAttempt.status, 403);
    assert.equal((await originAttempt.json()).error, "origin_rejected");
    page.on("pageerror", (error) => errors.push(error.name));
    await page.addInitScript((data) => {
      window.workflowFixture = data;
    }, fixture);
    await page.route("**/__author-live", (route) =>
      route.fulfill({
        contentType: "text/html",
        body:
          '<div id="root"></div><script type="module">' +
          built.outputFiles[0].text.replaceAll("</script", "<\\/script") +
          "</script>",
      }),
    );
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:3300")
        throw Error("unexpected_origin");
      if (["POST", "PATCH", "DELETE"].includes(request.method()))
        writes.push({
          path: url.pathname,
          method: request.method(),
          body: request.postDataJSON(),
        });
      const headers = { ...request.headers() };
      if (headers.cookie) throw Error("ambient_cookie_forbidden");
      delete headers.origin;
      const response = await route.fetch({
        url: "http://api:8080" + url.pathname + url.search,
        headers,
      });
      requests.push({
        group: url.pathname.includes("/auth/")
          ? "auth"
          : url.pathname === "/api/my/works"
            ? "catalog"
            : "other",
        status: response.status(),
      });
      if (response.headers()["x-tako-environment"] !== "test")
        throw Error("unexpected_environment");
      if (url.pathname === "/api/publications" && request.method() === "POST") {
        publications++;
        if (response.ok()) workID = (await response.json()).work_id;
        if (dropPublication) {
          dropPublication = false;
          await route.abort();
          return;
        }
      }
      await route.fulfill({ response });
    });
    stage = "catalog-and-publication";
    await page.goto("http://127.0.0.1:3300/__author-live");
    await active()
      .getByText(/已读取 20 件/)
      .waitFor();
    await button("加载更多作品").click();
    await active()
      .getByText(/已读取 40 件/)
      .waitFor();
    await button("加载更多作品").click();
    await active()
      .getByText(/已读取 45 件/)
      .waitFor();
    assert.equal(publications, 0);
    await button("发布服务器已保存稿件").click();
    await button("选择服务器稿件 " + fixture.title).click();
    await active()
      .getByRole("textbox", { name: "发布简介" })
      .fill("同一真实作品贯穿作者业务整体验收。");
    await button("发布标签 日常").click();
    await button("确认原创或取得发布授权").click();
    await button("生成固定预览").click();
    await text("固定预览 · 修订 R1").waitFor();
    await button("正式发布这份快照").click();
    await button("检查原发布请求").waitFor();
    assert.equal(publications, 1);
    stage = "publication-read-only-recovery";
    await button("返回").click();
    await page.getByRole("dialog", { name: "离开发布页？" }).waitFor();
    await page.getByRole("button", { name: "离开", exact: true }).click();
    await button("发布服务器已保存稿件").click();
    await button("进入作品管理").waitFor();
    assert.equal(publications, 1);
    assert.ok(workID);
    const originalWorkID = workID;
    await button("进入作品管理").click();
    await active()
      .getByRole("textbox", { name: "作品标题关键词" })
      .fill(fixture.prefix);
    await button("查找作品").click();
    await button("管理作品 " + fixture.title).click();
    await button("修订发行这部作品").waitFor();
    const saved = await page.evaluate(
      async (draft) =>
        window.authorWorkflow.session.authorized(`/drafts/${draft}`),
      fixture.draftId,
    );
    await page.evaluate(
      async ({ draftId, title }) =>
        window.authorWorkflow.session.authorized("/drafts/save", {
          method: "POST",
          body: {
            mutation_id: crypto.randomUUID(),
            draft_id: draftId,
            base_revision: 1,
            title,
            content: "整链路正式修订稿。\n保留独立工作稿与固定版本😀。",
          },
        }),
      { draftId: fixture.draftId, title: fixture.nextTitle },
    );
    stage = "directed-revision-retained-stack";
    await button("修订发行这部作品").click();
    await button("确认结果并核对目标作品").click();
    await text("修订发行：" + fixture.title).waitFor();
    await active()
      .getByRole("textbox", { name: "发布简介" })
      .fill("同一作品的第二正式版本。");
    await button("发布标签 日常").click();
    await button("确认原创或取得发布授权").click();
    await button("生成固定预览").click();
    await text("固定预览 · 修订 R2").waitFor();
    await button("正式发布这份快照").click();
    await button("进入作品管理").click();
    await button("返回作品列表").click();
    assert.equal(
      await active()
        .getByRole("textbox", { name: "作品标题关键词" })
        .inputValue(),
      fixture.prefix,
    );
    await button("管理作品 " + fixture.nextTitle).click();
    assert.equal(publications, 2);
    assert.equal(workID, originalWorkID);
    stage = "version-decision-and-reader";
    await button("核对展示指针与 V1").click();
    await button("展开当前指针版全文").click();
    await text("整链路正式修订稿。\n保留独立工作稿与固定版本😀。").waitFor();
    await button("展开候选版全文").click();
    await text(saved.content).waitFor();
    await button("按候选 V1 确认展示切换").click();
    await button("执行管理操作").click();
    await text("操作已确认，当前状态已重新读取。工作稿未修改。").waitFor();
    await button("查看读者当前展示").click();
    await text(fixture.title).waitFor();
    await text(saved.content).waitFor();
    const retainedDraft = await page.evaluate(
      async (draft) =>
        window.authorWorkflow.session.authorized(`/drafts/${draft}`),
      fixture.draftId,
    );
    assert.equal(retainedDraft.revision, 2);
    assert.equal(retainedDraft.title, fixture.nextTitle);
    stage = "reader-feedback-and-author-return";
    await page.evaluate(async (credentials) => {
      await window.authorWorkflow.session.logout();
      await window.authorWorkflow.session.signIn(
        "login",
        credentials.email,
        credentials.password,
      );
    }, fixture.reader);
    await button("查看评论").click();
    await active()
      .getByRole("textbox", { name: "评论正文" })
      .fill("读者整链路真实反馈");
    await button("发表").click();
    await text("读者整链路真实反馈").waitFor();
    await page.evaluate(async (credentials) => {
      await window.authorWorkflow.session.logout();
      await window.authorWorkflow.session.signIn(
        "login",
        credentials.email,
        credentials.password,
      );
    }, fixture.author);
    await button("刷新").click();
    await text("读者整链路真实反馈").waitFor();
    await button("回复").first().click();
    await active()
      .getByRole("textbox", { name: "评论正文" })
      .fill("作者整链路真实回应");
    await button("发表").click();
    await button("查看回复").first().click();
    await text("作者整链路真实回应").waitFor();
    await button("收起评论").click();
    await button("返回作品列表").click();
    // Account changes intentionally discard the old internal detail selection.
    await button("查看本人处置与复核").waitFor();
    assert.equal(
      await active()
        .getByRole("textbox", { name: "作品标题关键词" })
        .inputValue(),
      "",
    );
    assert.equal(
      await page.evaluate(() => window.authorWorkflow.stack.length),
      1,
    );
    stage = "moderation-and-appeal";
    const env = Object.fromEntries(
      fs
        .readFileSync("/materials/.runtime/local-test/.env", "utf8")
        .split(/\r?\n/)
        .filter((x) => x.includes("=") && !x.startsWith("#"))
        .map((x) => {
          const p = x.indexOf("=");
          return [x.slice(0, p), x.slice(p + 1)];
        }),
    );
    const operator = await api("/app/auth/login", "", {
      email: "operator@tako-test.invalid",
      password: env.TEST_OPERATOR_PASSWORD,
    });
    operatorToken = operator.access_token;
    const review = await api(
      `/ops/reviews/${workID}/versions/2`,
      operatorToken,
    );
    await api(`/ops/reviews/${workID}/versions/2`, operatorToken, {
      mutation_id: randomUUID(),
      expected_revision: review.task.revision,
      decision: "restrict_version",
      reason: "整体验收固定修订版处置",
    });
    const cases = await page.evaluate(async () =>
      window.authorWorkflow.session.authorized("/my/moderation"),
    );
    const caseID = cases.items.find((x) => x.work_id === workID).id;
    await button("查看本人处置与复核").click();
    await button(`查看处置 #${caseID}`).click();
    await text("处置原因：整体验收固定修订版处置").waitFor();
    await active()
      .getByRole("textbox", { name: "文字复核理由" })
      .fill("作者整体验收申请重新核对。");
    await button("确认复核理由").click();
    await button("提交这份复核申请").click();
    await text("申请已确认，当前处置与复核记录已重新读取。").waitFor();
    let detail = await api(`/ops/moderation/${caseID}`, operatorToken);
    assert.equal(detail.appeals.items.length, 1);
    await api(`/ops/moderation/${caseID}`, operatorToken, {
      mutation_id: randomUUID(),
      expected_revision: detail.case.revision,
      decision: "uphold",
      appeal_id: detail.appeals.items[0].id,
      reason: "整体验收维持说明",
    });
    await button("刷新处置").click();
    await text("结论理由：整体验收维持说明").waitFor();
    detail = await api(`/ops/moderation/${caseID}`, operatorToken);
    assert.ok(detail.case.next_appeal_at);
    await active()
      .getByText(/维持结论后的24小时冷静期/)
      .waitFor();
    await active()
      .getByRole("textbox", { name: "文字复核理由" })
      .fill("整体验收补充理由，交由服务端校验时间。");
    await button("确认复核理由").click();
    await button("提交这份复核申请").click();
    await text("仍处于服务端24小时冷静期，请查看可再次申请时间。").waitFor();
    assert.equal(
      (await api(`/ops/moderation/${caseID}`, operatorToken)).appeals.items
        .length,
      1,
    );
    await api(`/ops/moderation/${caseID}`, operatorToken, {
      mutation_id: randomUUID(),
      expected_revision: detail.case.revision,
      decision: "revoke",
      reason: "整体验收主动撤销说明",
    });
    await button("刷新处置").click();
    await text("整体验收主动撤销说明").waitFor();
    const final = await api(`/works/${workID}`);
    assert.equal(final.version, 1);
    assert.equal(final.title, fixture.title);
    assert.equal(
      writes.filter(
        (x) => x.path === `/api/my/moderation/${caseID}` && x.method === "POST",
      ).length,
      2,
    );
    assert.deepEqual(
      await page.evaluate(
        async (draft) =>
          window.authorWorkflow.session.authorized(`/drafts/${draft}`),
        fixture.draftId,
      ),
      retainedDraft,
    );
    assert.deepEqual(errors, []);
    console.log("PASS real author workflow");
  } catch (error) {
    const snapshot = await page
      .evaluate(() => {
        const s = window.authorWorkflow?.session.snapshot();
        return { phase: s?.phase, code: s?.error?.code };
      })
      .catch(() => ({}));
    if (["loading", "guest", "ready", "offline"].includes(snapshot.phase))
      console.error("workflow_phase=" + snapshot.phase);
    if (
      [
        "rate_limited",
        "origin_rejected",
        "invalid_login",
        "network",
        "environment",
      ].includes(snapshot.code)
    )
      console.error("workflow_code=" + snapshot.code);
    console.error(
      "workflow_requests=" +
        requests
          .slice(-8)
          .map((x) => x.group + ":" + x.status)
          .join(","),
    );
    console.error("workflow_page_errors=" + errors.length);
    const line = String(error.stack).match(/run\.cjs:(\d+):\d+/)?.[1];
    if (line) console.error("workflow_line=" + Number(line));
    const allowed = [
      "invalid_input",
      "rate_limited",
      "authentication_required",
      "review_conflict",
      "appeal_cooldown",
      "environment",
    ];
    if (allowed.includes(error.code))
      console.error("workflow_code=" + error.code);
    console.error("FAIL real author workflow stage=" + stage);
    process.exitCode = 1;
  } finally {
    try {
      await page.evaluate(async () => {
        if (window.authorWorkflow?.session.snapshot().phase === "ready")
          await window.authorWorkflow.session.logout();
      });
    } catch {
      console.error("FAIL real author workflow stage=cleanup");
      process.exitCode = 1;
    }
    if (operatorToken)
      try {
        await api("/app/auth/logout", operatorToken, {});
      } catch {
        console.error("FAIL real author workflow stage=cleanup");
        process.exitCode = 1;
      }
    await browser.close();
  }
})().catch(() => {
  console.error("FAIL real author workflow stage=" + stage);
  process.exitCode = 1;
});
