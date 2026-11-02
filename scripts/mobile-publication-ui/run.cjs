const esbuild = require("/tools/node_modules/esbuild");
const { chromium } = require("/tools/node_modules/playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
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
              path: path.join(__dirname, "../mobile-comments-ui/native.jsx"),
            }),
          );
          build.onResolve({ filter: /^expo-router$/ }, () => ({
            path: path.join(__dirname, "router.jsx"),
          }));
          build.onResolve({ filter: /^react-native-svg$/ }, () => ({
            path: path.join(__dirname, "../mobile-versions-ui/svg.jsx"),
          }));
          build.onResolve({ filter: /^expo-secure-store$/ }, () => ({
            path: path.join(__dirname, "store.jsx"),
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
  const a = "22222222-2222-4222-8222-222222222222",
    b = "33333333-3333-4333-8333-333333333333",
    draft = "44444444-4444-4444-8444-444444444444",
    previewId = "55555555-5555-4555-8555-555555555555",
    nextPreviewId = "88888888-8888-4888-8888-888888888888",
    work = "66666666-6666-4666-8666-666666666666";
  let prepares = 0,
    publishes = 0,
    sourceReads = 0,
    previewReads = 0,
    publicationRequests = 0,
    offline = false,
    published = false,
    nextReadFails = true,
    nextJournalVisible = false,
    stateReads = 0,
    preparedBody,
    errors = [];
  const result = {
    work_id: work,
    version: 1,
    published_at: "2026-11-02T00:00:00Z",
    review_status: "pending",
  };
  const snapshot = () => ({
    id: previewId,
    draft_id: draft,
    source_revision: 1,
    expected_version: 0,
    title: "固定快照标题",
    content: "固定快照正文",
    introduction: preparedBody?.introduction ?? "",
    tags: preparedBody?.tags ?? ["日常"],
    created_at: "2026-11-02T00:00:00Z",
    expires_at: "2099-11-03T00:00:00Z",
    ...(published ? { published: result } : {}),
  });
  const json = (route, value, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: { "X-Tako-Environment": "test" },
      body: JSON.stringify(value),
    });
  page.on("pageerror", (e) => errors.push(e.name));
  try {
    await page.route("**/__publication", (route) =>
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
        pathname = new URL(request.url()).pathname,
        body = request.postDataJSON(),
        viewer = request.headers().authorization?.endsWith("b".repeat(64))
          ? b
          : a;
      if (pathname.startsWith("/api/publication")) publicationRequests++;
      if (offline) return route.abort();
      if (pathname === "/api/app/auth/login")
        return json(route, {
          account: { id: body.email.startsWith("b@") ? b : a, nickname: "" },
          token_type: "Bearer",
          expires_in: 604800,
          access_token:
            "tako_app_" + (body.email.startsWith("b@") ? "b" : "a").repeat(64),
        });
      if (pathname === "/api/app/auth/logout")
        return route.fulfill({
          status: 204,
          headers: { "X-Tako-Environment": "test" },
        });
      if (pathname === "/api/me")
        return json(route, { id: viewer, nickname: "作者" });
      if (pathname === "/api/my/works")
        return json(route, { items: [], next_cursor: "" });
      if (pathname === "/api/drafts")
        return json(route, {
          items:
            viewer === a
              ? [{ id: draft, title: "服务器稿件", revision: 1 }]
              : [],
          next_cursor: "",
        });
      if (pathname === "/api/drafts/" + draft) {
        sourceReads++;
        return json(route, {
          id: draft,
          title: "服务器稿件",
          content: "服务器已保存正文",
          revision: 2,
          saved_at: "2026-11-02T00:00:00Z",
        });
      }
      if (pathname === "/api/publication-previews") {
        prepares++;
        preparedBody = body;
        return json(route, snapshot());
      }
      if (pathname === "/api/publication-previews/" + previewId) {
        previewReads++;
        return json(route, snapshot());
      }
      if (pathname === "/api/publication-previews/" + nextPreviewId) {
        if (nextReadFails) {
          nextReadFails = false;
          return json(route, { error: "service_unavailable" }, 503);
        }
        return json(route, {
          ...snapshot(),
          id: nextPreviewId,
          expected_version: 1,
          content: "后续发布快照正文",
          published: { ...result, version: 2 },
        });
      }
      if (pathname === "/api/publications") {
        publishes++;
        published = true;
        if (publishes === 1) return route.abort();
        return json(route, result);
      }
      if (pathname === "/api/my/works/" + work) {
        stateReads++;
        if (stateReads === 1) return route.abort();
        return json(route, {
          id: work,
          draft_id: draft,
          last_version: nextJournalVisible ? 2 : 1,
          display_version: 1,
          state_revision: 2,
          author_hidden: true,
          history_open: false,
          platform_limited: false,
        });
      }
      return json(route, { error: "resource_not_found" }, 404);
    });
    stage = "session-envelope";
    await page.goto("http://127.0.0.1:3300/__publication");
    await page.getByRole("button", { name: "发布服务器已保存稿件" }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.publishUi.session.snapshot().drafts.phase,
      ),
      "confirmation",
    );
    stage = "incomplete-editor-handoff";
    await page.evaluate((draft) => {
      window.publishUi.params = { draft_id: draft };
      window.publishUi.navigate("/publish");
    }, draft);
    await page.getByText("发布入口参数无效", { exact: true }).waitFor();
    assert.equal(sourceReads, 0);
    assert.equal(prepares, 0);
    assert.equal(publishes, 0);
    await page.getByRole("button", { name: "返回作品管理" }).click();
    stage = "unconfirmed-editor-revision";
    await page.evaluate((draft) => {
      window.publishUi.params = { draft_id: draft, source_revision: "3" };
      window.publishUi.navigate("/publish");
    }, draft);
    await page
      .getByText("无法读取这份服务器修订，请回草稿箱确认保存后重新选择。", {
        exact: true,
      })
      .waitFor();
    assert.equal(prepares, 0);
    assert.equal(publishes, 0);
    await page.getByRole("button", { name: "返回", exact: true }).click();
    stage = "confirmed-old-editor-revision";
    await page.evaluate((draft) => {
      window.publishUi.params = { draft_id: draft, source_revision: "1" };
      window.publishUi.navigate("/publish");
    }, draft);
    await page.getByText("采用服务器修订 R1", { exact: true }).waitFor();
    await page
      .getByText(
        "当前服务器最新为 R2。预览将由服务器读取选定修订的标题和正文。",
        { exact: true },
      )
      .waitFor();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    assert.equal(prepares, 0);
    assert.equal(publishes, 0);
    await page.evaluate(() => {
      window.publishUi.params = {};
    });
    await page.getByRole("button", { name: "发布服务器已保存稿件" }).click();
    await page
      .getByRole("button", { name: "选择服务器稿件 服务器稿件" })
      .click();
    stage = "authorization-and-snapshot";
    assert.equal(
      await page.getByRole("button", { name: "生成固定预览" }).isDisabled(),
      true,
    );
    await page
      .getByRole("textbox", { name: "发布简介" })
      .fill("仅用于夹具的简介");
    await page.getByRole("button", { name: "发布标签 日常" }).click();
    await page.getByRole("button", { name: "确认原创或取得发布授权" }).click();
    assert.equal(
      await page.getByRole("button", { name: "生成固定预览" }).isDisabled(),
      true,
    );
    await page.getByRole("textbox", { name: "发布笔名" }).fill("发布夹具作者");
    await page.getByRole("button", { name: "保存发布笔名" }).click();
    assert.equal(
      await page.getByRole("textbox", { name: "发布简介" }).inputValue(),
      "仅用于夹具的简介",
    );
    await page.getByRole("button", { name: "生成固定预览" }).click();
    await page.getByText("固定快照正文", { exact: true }).waitFor();
    assert.equal(prepares, 1);
    assert.equal(preparedBody.source_revision, 1);
    assert.equal(publishes, 0);
    stage = "storage-failure";
    await page.evaluate(() => {
      window.publishUi.failStore = true;
    });
    await page.getByRole("button", { name: "正式发布这份快照" }).click();
    await page
      .getByText("无法保留发布标识，本次不会发出新的发布请求，请重试。", {
        exact: true,
      })
      .waitFor();
    assert.equal(publishes, 0);
    stage = "unknown-result";
    await page.getByRole("button", { name: "检查原发布请求" }).click();
    await page
      .getByText("结果尚未确认，请检查原请求，勿重复新建发布。", {
        exact: true,
      })
      .waitFor();
    assert.equal(publishes, 1);
    const saved = await page.evaluate(
      () => [...window.publishUi.journal.values()][0],
    );
    assert.ok(saved.includes(previewId));
    assert.ok(saved.length < 1024);
    assert.ok(!saved.includes("固定快照"));
    assert.ok(!saved.includes("简介"));
    stage = "remount-read-only";
    const beforeRestoreReads = sourceReads;
    await page.evaluate(() => {
      window.publishUi.params = {
        draft_id: "77777777-7777-4777-8777-777777777777",
        source_revision: "1",
      };
      window.publishUi.navigate("/my-works");
    });
    await page.getByRole("button", { name: "发布服务器已保存稿件" }).click();
    await page.getByText("已确认正式版本 V1", { exact: true }).waitFor();
    await page
      .getByText(
        "当前显示的是先前发布记录的固定快照，不是本次传入的稿件或修订。请先核对原结果；不会自动发布本次稿件。",
        { exact: true },
      )
      .waitFor();
    assert.equal(sourceReads, beforeRestoreReads);
    assert.equal(prepares, 1);
    assert.equal(publishes, 1);
    stage = "confirmed-state-read-retry";
    await page
      .getByText("发布已确认，暂时无法读取作品当前状态，请重试读取。", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page
        .getByText("结果尚未确认，请检查原请求，勿重复新建发布。", {
          exact: true,
        })
        .count(),
      0,
    );
    const beforeStateRetry = publicationRequests;
    await page
      .getByRole("button", { name: "重新读取作品现状", exact: true })
      .click();
    await page
      .getByText("当前展示 V1 · 作者仍隐藏作品", { exact: true })
      .waitFor();
    assert.equal(stateReads, 2);
    assert.equal(publicationRequests, beforeStateRetry);
    assert.equal(publishes, 1);
    assert.equal(
      await page
        .getByText("发布已确认，暂时无法读取作品当前状态，请重试读取。", {
          exact: true,
        })
        .count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "读取当前展示版本" }).count(),
      0,
    );
    stage = "offline-grant-blocks-publication";
    await page.evaluate(() => window.publishUi.session.confirmDraftAccess());
    const beforeOfflineReads = previewReads;
    const beforeOfflineRequests = publicationRequests;
    offline = true;
    await page.evaluate(() => window.publishUi.session.restore());
    await page.getByText("确认账号后发布", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.publishUi.session.snapshot().drafts.phase,
      ),
      "offline",
    );
    assert.equal(
      await page.getByText("固定快照正文", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByText("已确认正式版本 V1", { exact: true }).count(),
      0,
    );
    assert.equal(previewReads, beforeOfflineReads);
    assert.equal(publicationRequests, beforeOfflineRequests);
    assert.equal(publishes, 1);
    assert.equal(
      await page.evaluate(() => [...window.publishUi.journal.values()][0]),
      saved,
    );
    stage = "online-grant-restores-journal";
    offline = false;
    await page.getByRole("button", { name: "重试确认账号" }).click();
    await page.getByText("已确认正式版本 V1", { exact: true }).waitFor();
    assert.equal(previewReads, beforeOfflineReads + 1);
    assert.equal(publishes, 1);
    stage = "replacement-read-failure";
    const replacement = JSON.stringify({
      v: 1,
      account_id: a,
      draft_id: draft,
      source_revision: 1,
      request: {
        mutation_id: "99999999-9999-4999-8999-999999999999",
        preview_id: nextPreviewId,
        expected_version: 1,
      },
    });
    // Model tests drive two real flows; this injects the other page's minimal
    // journal to verify the actual old component cannot acknowledge it early.
    await page.evaluate((value) => {
      const key = [...window.publishUi.journal.keys()][0];
      window.publishUi.journal.set(key, value);
    }, replacement);
    nextJournalVisible = true;
    await page.getByRole("button", { name: "读取已保留的发布记录" }).click();
    await page
      .getByText("暂时无法完成，请重试读取或检查原操作。", { exact: true })
      .waitFor();
    await page.getByText("确认本人稿件与发布记录", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("已确认正式版本 V1", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "确认结果并选择其他稿件" })
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(() => [...window.publishUi.journal.values()][0]),
      replacement,
    );
    assert.equal(publishes, 1);
    stage = "replacement-read-retry";
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await page.getByText("已确认正式版本 V2", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => [...window.publishUi.journal.values()][0]),
      replacement,
    );
    assert.equal(publishes, 1);
    stage = "account-switch";
    await page.evaluate(async () => {
      window.publishUi.params = {};
      await window.publishUi.session.logout();
      await window.publishUi.session.signIn(
        "login",
        "b@example.test",
        "fixture-password",
      );
    });
    await page.getByText("服务器暂无稿件", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.publishUi.session.snapshot().drafts.phase,
      ),
      "confirmation",
    );
    assert.equal(
      await page.getByText("固定快照正文", { exact: true }).count(),
      0,
    );
    assert.equal(publishes, 1);
    assert.equal(
      await page.getByText("已确认正式版本 V2", { exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS publication fixtures: session envelope, strict handoff, explicit rights, durable unknown result, offline grant isolation, read-only recovery, failed replacement read hides old success and cannot acknowledge the new journal, explicit retry and account isolation. Not native-storage evidence.",
    );
  } catch (error) {
    console.error("Publication fixture failed at " + stage + ": " + error.name);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(() => {
  console.error("Publication fixture dependency or bundle failure");
  process.exitCode = 1;
});
