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
              path: path.join(__dirname, "../mobile-comments-ui/native.jsx"),
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
    failRead = false;
  const receipts = new Map(),
    attempts = [],
    errors = [];
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
      if (p === "/api/my/works")
        return json(route, {
          items: viewer === a ? [{ ...state, title: "甲的正式作品" }] : [],
          next_cursor: "",
        });
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
    await page.goto("http://127.0.0.1:3300/__author");
    await page.getByRole("button", { name: "管理本人作品" }).click();
    await page.getByRole("button", { name: "管理作品 甲的正式作品" }).click();
    stage = "lost-response";
    await page.getByRole("button", { name: "隐藏作品", exact: true }).click();
    assert.equal(attempts.length, 0);
    await page.getByRole("button", { name: "执行管理操作" }).click();
    await page.getByRole("button", { name: "检查原管理操作" }).waitFor();
    assert.equal(await page.evaluate(() => window.authorUi.blocked), true);
    await page.getByRole("button", { name: "检查原管理操作" }).click();
    await page
      .getByText("操作已确认，当前状态已重新读取。工作稿未修改。", {
        exact: true,
      })
      .waitFor();
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal(receipts.size, 1);
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
    stage = "account-switch";
    await page.evaluate(async () => {
      await window.authorUi.session.logout();
      await window.authorUi.session.signIn(
        "login",
        "b@example.test",
        "fixture-password",
      );
    });
    await page.getByText("还没有正式作品", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("私有版本1", { exact: false }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS author component fixtures: real entry, confirmation, uncertain retry, fresh state, restricted restore, cancellation, conflict, read failure and account isolation.",
    );
  } catch (error) {
    console.error("Author fixture failed at " + stage + ": " + error.name);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(() => {
  console.error("Author fixture dependency or bundle failure");
  process.exitCode = 1;
});
