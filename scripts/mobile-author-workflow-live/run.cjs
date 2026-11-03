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
  const faults = new Set();
  let failPublicationRecovery = false,
    corruptManagement = true,
    failManagementRead = false,
    dropAppeal = true,
    failAppealRead = false,
    failFeedbackRead = true,
    dropFeedbackReply = true,
    dropFeedbackDelete = true,
    failInboxRead = true;
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
          failPublicationRecovery = true;
          await route.abort();
          return;
        }
      }
      if (
        response.ok() &&
        request.method() === "GET" &&
        failPublicationRecovery &&
        url.pathname.startsWith("/api/publication-previews/")
      ) {
        failPublicationRecovery = false;
        faults.add("publication-recovery-read");
        await route.abort();
        return;
      }
      if (
        response.ok() &&
        request.method() === "POST" &&
        url.pathname === "/api/my/works/" + workID + "/actions" &&
        request.postDataJSON().action === "switch_display"
      ) {
        if (corruptManagement) {
          corruptManagement = false;
          faults.add("management-receipt");
          const value = await response.json();
          assert.equal(request.postDataJSON().version, 1);
          assert.equal(value.display_version, 1);
          await route.fulfill({
            response,
            json: { ...value, display_version: value.last_version },
          });
          return;
        }
        failManagementRead = true;
      }
      if (
        response.ok() &&
        request.method() === "GET" &&
        failManagementRead &&
        url.pathname === "/api/my/works/" + workID + "/versions"
      ) {
        failManagementRead = false;
        faults.add("management-state-read");
        await route.abort();
        return;
      }
      if (
        response.ok() &&
        request.method() === "POST" &&
        /^\/api\/my\/moderation\/\d+$/.test(url.pathname)
      ) {
        if (dropAppeal) {
          dropAppeal = false;
          faults.add("appeal-response");
          await route.abort();
          return;
        }
        failAppealRead = true;
      }
      if (
        response.ok() &&
        request.method() === "GET" &&
        failAppealRead &&
        /^\/api\/my\/moderation\/\d+$/.test(url.pathname)
      ) {
        failAppealRead = false;
        faults.add("appeal-state-read");
        await route.abort();
        return;
      }

      if (
        response.ok() &&
        stage === "author-feedback-workspace" &&
        failFeedbackRead &&
        request.method() === "GET" &&
        url.pathname === "/api/my/works/" + workID + "/versions"
      ) {
        faults.add("feedback-entry-read");
        await route.abort();
        return;
      }
      if (
        response.ok() &&
        dropFeedbackReply &&
        request.method() === "POST" &&
        url.pathname === "/api/works/" + workID + "/comments" &&
        request.postDataJSON().reply_to
      ) {
        dropFeedbackReply = false;
        faults.add("feedback-reply-response");
        await route.abort();
        return;
      }
      if (
        response.ok() &&
        dropFeedbackDelete &&
        request.method() === "POST" &&
        /^\/api\/comments\/[^/]+\/actions$/.test(url.pathname)
      ) {
        dropFeedbackDelete = false;
        faults.add("feedback-delete-response");
        await route.abort();
        return;
      }
      if (
        response.ok() &&
        failInboxRead &&
        stage === "feedback-inbox" &&
        request.method() === "GET" &&
        url.pathname === "/api/my/work-feedback"
      ) {
        faults.add("feedback-inbox-read");
        await route.abort();
        return;
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
    await button("重新加载").waitFor();
    assert.equal(await button("选择服务器稿件 " + fixture.title).count(), 0);
    assert.equal(publications, 1);
    await button("重新加载").click();
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
    assert.equal(await button("生成固定预览").isDisabled(), true);
    stage = "revision-prepublication-review";
    await button("读取本次修订与正式展示版").click();
    await text("整链路正式修订稿。\n保留独立工作稿与固定版本😀。").waitFor();
    await text(saved.content).waitFor();
    assert.equal(await button("生成固定预览").isDisabled(), true);
    await button("采用已核对修订 R2").click();
    // A later server save must not silently replace the adopted R2 snapshot.
    await page.evaluate(
      async (draftId) =>
        window.authorWorkflow.session.authorized("/drafts/save", {
          method: "POST",
          body: {
            mutation_id: crypto.randomUUID(),
            draft_id: draftId,
            base_revision: 2,
            title: "后续工作稿保留",
            content: "核对后新增的R3文字，不属于本次发行。",
          },
        }),
      fixture.draftId,
    );
    stage = "directed-revision-retained-stack";
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
    stage = "restore-eligibility";
    await button("隐藏作品").click();
    await button("执行管理操作").click();
    await text("操作已确认，当前状态已重新读取。工作稿未修改。").waitFor();
    await button("核对展示指针与 V1").click();
    await text(
      "最新版 V2 正常，恢复需展示最新版；此候选仍可核对。请在管理区选择恢复最新版本。",
    ).waitFor();
    assert.equal(await button("按候选 V1 确认恢复公开").count(), 0);
    const rejectedRestore = await page.evaluate(async (id) => {
      const state = await window.authorWorkflow.session.authorized(
        "/my/works/" + id,
      );
      try {
        await window.authorWorkflow.session.authorized(
          "/my/works/" + id + "/actions",
          {
            method: "POST",
            body: {
              mutation_id: crypto.randomUUID(),
              expected_state_revision: state.state_revision,
              action: "restore",
              version: 1,
            },
          },
        );
        return 200;
      } catch (error) {
        return error.status;
      }
    }, workID);
    assert.equal(rejectedRestore, 400);
    await button("结束本次版本核对").click();
    await button("恢复公开并展示最新 V2").click();
    await button("执行管理操作").click();
    await text("操作已确认，当前状态已重新读取。工作稿未修改。").waitFor();
    stage = "version-decision-and-reader";
    await button("核对展示指针与 V1").click();
    await button("展开当前指针版全文").click();
    await text("整链路正式修订稿。\n保留独立工作稿与固定版本😀。").waitFor();
    await button("展开候选版全文").click();
    await text(saved.content).waitFor();
    await button("按候选 V1 确认展示切换").click();
    stage = "management-uncertain-recovery";
    await button("执行管理操作").click();
    await button("检查原管理操作").click({ trial: true });
    assert.equal(await button("查看读者当前展示").isDisabled(), true);
    assert.equal(await button("修订发行这部作品").isDisabled(), true);
    assert.equal((await api("/works/" + workID)).version, 1);
    await button("检查原管理操作").click();
    await text("操作已确认，暂时无法读取作品当前状态，请重试读取。").waitFor();
    assert.equal(await button("检查原管理操作").count(), 0);
    const switches = () =>
      writes.filter(
        (x) =>
          x.path === "/api/my/works/" + workID + "/actions" &&
          x.body?.action === "switch_display",
      );
    assert.equal(switches().length, 2);
    assert.deepEqual(switches()[0].body, switches()[1].body);
    await button("重新加载").click();
    await text("操作已确认，当前状态已重新读取。工作稿未修改。").waitFor();
    assert.equal(switches().length, 2);
    await button("查看读者当前展示").click();
    await text(fixture.title).waitFor();
    await text(saved.content).waitFor();
    const retainedDraft = await page.evaluate(
      async (draft) =>
        window.authorWorkflow.session.authorized(`/drafts/${draft}`),
      fixture.draftId,
    );
    assert.equal(retainedDraft.revision, 3);
    assert.equal(retainedDraft.title, "后续工作稿保留");
    assert.equal(retainedDraft.content, "核对后新增的R3文字，不属于本次发行。");
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
    await button("收起评论").click();
    await button("返回作品列表").click();
    // Account changes discard the previous author's old internal selection.
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
    await active()
      .getByRole("textbox", { name: "作品标题关键词" })
      .fill(fixture.prefix);
    await button("查找作品").click();
    await button("管理作品 " + fixture.title).click();
    await button("处理作品反馈").click({ trial: true });
    stage = "author-feedback-workspace";
    await button("处理作品反馈").click();
    await text("无法读取作品反馈").waitFor();
    failFeedbackRead = false;
    assert.equal(await button("发表").count(), 0);
    await button("重新加载").click();
    await text("读者整链路真实反馈").waitFor();
    const rootId = await page.evaluate(
      async (id) =>
        (
          await window.authorWorkflow.session.authorized(
            "/works/" + id + "/comments?cursor=0",
          )
        ).items[0].id,
      workID,
    );
    await button("收起评论").click();
    await button("返回作品管理").click();
    await button("处理作品反馈").waitFor();
    await button("返回作品列表").click();
    assert.equal(
      await active()
        .getByRole("textbox", { name: "作品标题关键词" })
        .inputValue(),
      fixture.prefix,
    );
    assert.equal(
      await page.evaluate(() => window.authorWorkflow.stack.length),
      1,
    );
    await button("管理作品 " + fixture.title).click();
    await button("处理作品反馈").click();
    await text("读者整链路真实反馈").waitFor();
    await button("回复").first().click();
    await active()
      .getByRole("textbox", { name: "评论正文" })
      .fill("作者暂存输入");
    await button("收起评论").click();
    assert.equal(await button("重新确认反馈访问").isDisabled(), true);
    await button("返回作品管理").click();
    await page.getByRole("dialog", { name: "离开作者反馈？" }).waitFor();
    await page.getByRole("button", { name: "继续处理", exact: true }).click();
    await button("打开作品评论").click();
    assert.equal(
      await active().getByRole("textbox", { name: "评论正文" }).inputValue(),
      "作者暂存输入",
    );
    failFeedbackRead = true;
    await page.evaluate(async () => window.authorWorkflow.session.logout());
    await text("登录后继续处理本人反馈").waitFor();
    assert.equal(
      await active().getByRole("textbox", { name: "评论正文" }).count(),
      0,
    );
    await page.evaluate(
      async (credentials) =>
        window.authorWorkflow.session.signIn(
          "login",
          credentials.email,
          credentials.password,
        ),
      fixture.author,
    );
    await text("无法读取作品反馈").waitFor();
    failFeedbackRead = false;
    await button("重新加载").click();
    await text("恢复本账号在当前页面的未发表文字？").waitFor();
    await button("保留文字").click();
    assert.equal(
      await active().getByRole("textbox", { name: "评论正文" }).inputValue(),
      "作者暂存输入",
    );
    await active()
      .getByRole("textbox", { name: "评论正文" })
      .fill("作者整链路真实回应");
    await button("发表").click();
    await button("检查原发表").click({ trial: true });
    await button("收起评论").click();
    assert.equal(await button("重新确认反馈访问").isDisabled(), true);
    await button("打开作品评论").click();
    await button("检查原发表").click();
    await text("评论已发表。").waitFor();
    const replyWrites = writes.filter(
      (x) => x.path === "/api/works/" + workID + "/comments" && x.body.reply_to,
    );
    assert.equal(replyWrites.length, 2);
    assert.deepEqual(replyWrites[0].body, replyWrites[1].body);
    await button("查看回复").first().click();
    await text("作者整链路真实回应").waitFor();
    const replyPage = await page.evaluate(
      async ({ id, root }) =>
        window.authorWorkflow.session.authorized(
          "/works/" + id + "/comments?cursor=0&root=" + root,
        ),
      { id: workID, root: rootId },
    );
    assert.equal(replyPage.items.length, 1);
    await button("删除").first().click();
    await page
      .getByRole("dialog", { name: "删除评论" })
      .getByText("主评论和全部回复将一起删除，无法恢复。", { exact: true })
      .waitFor();
    await page
      .getByRole("dialog", { name: "删除评论" })
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await button("检查原删除操作").click({ trial: true });
    await button("收起评论").click();
    assert.equal(await button("重新确认反馈访问").isDisabled(), true);
    await button("打开作品评论").click();
    await button("检查原删除操作").click();
    await text("评论已删除。").waitFor();
    await text("还没有评论，读完说说你的想法。").waitFor();
    const deleteWrites = writes.filter(
      (x) => x.path === "/api/comments/" + rootId + "/actions",
    );
    assert.equal(deleteWrites.length, 2);
    assert.deepEqual(deleteWrites[0].body, deleteWrites[1].body);
    const afterDelete = await page.evaluate(
      async (id) =>
        window.authorWorkflow.session.authorized(
          "/works/" + id + "/comments?cursor=0",
        ),
      workID,
    );
    assert.equal(afterDelete.items.length, 0);
    const afterReplies = await page.evaluate(
      async ({ id, root }) => {
        try {
          return (
            await window.authorWorkflow.session.authorized(
              "/works/" + id + "/comments?cursor=0&root=" + root,
            )
          ).items.length;
        } catch (e) {
          if (e.status === 404) return 0;
          throw e;
        }
      },
      { id: workID, root: rootId },
    );
    assert.equal(afterReplies, 0);
    await button("收起评论").click();
    await button("返回作品管理").click();
    // Reauthentication intentionally clears the underlying management selection.
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
    // Same-page account replacement must not reveal the previous author's state.
    await page.evaluate(
      (id) =>
        window.authorWorkflow.navigate("push", {
          pathname: "/my-work-feedback/[id]",
          params: { id },
        }),
      workID,
    );
    await active().getByRole("textbox", { name: "评论正文" }).waitFor();
    await active()
      .getByRole("textbox", { name: "评论正文" })
      .fill("切号前作者私有输入");
    await page.evaluate(async (credentials) => {
      await window.authorWorkflow.session.logout();
      await window.authorWorkflow.session.signIn(
        "login",
        credentials.email,
        credentials.password,
      );
    }, fixture.reader);
    await text("作品反馈暂不可读").waitFor();
    assert.equal(
      await active().getByRole("textbox", { name: "评论正文" }).count(),
      0,
    );
    assert.equal(await text(fixture.title).count(), 0);
    await page.evaluate(async (credentials) => {
      await window.authorWorkflow.session.logout();
      await window.authorWorkflow.session.signIn(
        "login",
        credentials.email,
        credentials.password,
      );
    }, fixture.author);
    await active().getByRole("textbox", { name: "评论正文" }).waitFor();
    assert.equal(
      await active().getByRole("textbox", { name: "评论正文" }).inputValue(),
      "",
    );
    await button("收起评论").click();
    await button("返回作品管理").click();
    await button("查看本人处置与复核").waitFor();
    stage = "feedback-inbox";
    // Prepare one new reader root through real APIs; reader composition UI was
    // already exercised above. Never insert fictitious successful responses.
    await page.evaluate(
      async ({ reader, author, id }) => {
        const session = window.authorWorkflow.session;
        await session.logout();
        await session.signIn("login", reader.email, reader.password);
        const value = await session.authorized("/works/" + id);
        await session.authorized("/works/" + id + "/comments", {
          method: "POST",
          body: {
            mutation_id: crypto.randomUUID(),
            expected_account_id: session.snapshot().account.id,
            content: "收件箱定位讨论",
            context: value.comment_context,
          },
        });
        await session.logout();
        await session.signIn("login", author.email, author.password);
      },
      { reader: fixture.reader, author: fixture.author, id: workID },
    );
    await button("读者反馈收件箱").click();
    await text("反馈读取失败").waitFor();
    failInboxRead = false;
    await button("重新加载").click();
    await text("收件箱定位讨论").waitFor();
    const inboxItem = await page.evaluate(
      async (id) =>
        (
          await window.authorWorkflow.session.authorized(
            "/my/work-feedback?status=awaiting_author&cursor=0",
          )
        ).items.find((x) => x.comment.work_id === id),
      workID,
    );
    assert.equal(inboxItem.awaiting_author, true);
    const openThread = async () =>
      button("打开反馈讨论 " + inboxItem.comment.sequence).click();
    await openThread();
    await text("收件箱定位讨论").waitFor();
    await button("回复").first().click();
    await active()
      .getByRole("textbox", { name: "评论正文" })
      .fill("收件箱作者回应");
    await button("发表").click();
    await text("评论已发表。").waitFor();
    await button("收起评论").click();
    await button("返回反馈收件箱").click();
    await text("暂无待回应讨论").waitFor();
    await button("全部讨论").click();
    await active()
      .getByText(/已有作者回复$/)
      .waitFor();
    await openThread();
    await button("查看回复").first().click();
    await text("收件箱作者回应").waitFor();
    await button("删除").nth(1).click();
    await page
      .getByRole("dialog", { name: "删除评论" })
      .getByText("删除这条回复？", { exact: true })
      .waitFor();
    await page
      .getByRole("dialog", { name: "删除评论" })
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await text("评论已删除。").waitFor();
    await button("收起评论").click();
    await button("返回反馈收件箱").click();
    await button("待回应讨论").click();
    await text("收件箱定位讨论").waitFor();
    const pendingAgain = await page.evaluate(
      async (id) =>
        (
          await window.authorWorkflow.session.authorized(
            "/my/work-feedback/" + id,
          )
        ).awaiting_author,
      inboxItem.comment.id,
    );
    assert.equal(pendingAgain, true);
    await openThread();
    await button("回复").first().click();
    await active()
      .getByRole("textbox", { name: "评论正文" })
      .fill("再次回应供整串删除");
    await button("发表").click();
    await text("评论已发表。").waitFor();
    await button("查看回复").first().click();
    await text("再次回应供整串删除").waitFor();
    await button("删除").first().click();
    await page
      .getByRole("dialog", { name: "删除评论" })
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await text("评论已删除。").waitFor();
    await text("还没有评论，读完说说你的想法。").waitFor();
    await button("收起评论").click();
    await button("返回反馈收件箱").click();
    await text("暂无待回应讨论").waitFor();
    await button("全部讨论").click();
    await text("暂无可见反馈").waitFor();
    await button("返回作品管理").click();
    await button("查看本人处置与复核").waitFor();
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
    stage = "appeal-uncertain-recovery";
    await button("提交这份复核申请").click();
    await button("检查原复核申请").waitFor();
    assert.equal(
      await active()
        .getByRole("textbox", { name: "文字复核理由" })
        .isDisabled(),
      true,
    );
    await button("返回处置列表").click();
    await page.getByRole("dialog", { name: "复核内容尚在本页" }).waitFor();
    await page.getByRole("button", { name: "留在本页", exact: true }).click();
    await button("检查原复核申请").click();
    await text(
      "申请已确认，当前处置读取未完成。请重试读取，不会再次提交。",
    ).waitFor();
    const appeals = () =>
      writes.filter(
        (x) => x.path === "/api/my/moderation/" + caseID && x.method === "POST",
      );
    assert.equal(appeals().length, 2);
    assert.deepEqual(appeals()[0].body, appeals()[1].body);
    await button("重新读取处置现状").click();
    await text("申请已确认，当前处置与复核记录已重新读取。").waitFor();
    assert.equal(appeals().length, 2);
    stage = "moderation-and-appeal";
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
      3,
    );
    assert.deepEqual(
      [...faults].sort(),
      [
        "feedback-inbox-read",
        "feedback-entry-read",
        "feedback-reply-response",
        "feedback-delete-response",
        "publication-recovery-read",
        "management-receipt",
        "management-state-read",
        "appeal-response",
        "appeal-state-read",
      ].sort(),
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
      "resource_not_found",
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
