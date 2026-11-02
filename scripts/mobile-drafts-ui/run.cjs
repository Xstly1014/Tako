const esbuild = require("/tools/node_modules/esbuild");
const { chromium } = require("/tools/node_modules/playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
let stage = "bundle";
(async () => {
  const built = await esbuild.build({ entryPoints: [path.join(__dirname, "entry.jsx")], bundle: true, write: false,
    define: { "process.env.NODE_ENV": '"development"', "process.env.EXPO_PUBLIC_API_URL": '"http://127.0.0.1:3300/api"' },
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx", target: "ES2022" } }, format: "esm", jsx: "automatic", loader: { ".png": "dataurl" }, nodePaths: ["/app/node_modules"],
    plugins: [{ name: "fixture", setup(build) {
      build.onResolve({ filter: /^react-native$|^react-native-safe-area-context$/ }, () => ({ path: path.join(__dirname, "native.jsx") }));
      build.onResolve({ filter: /^expo-router$/ }, () => ({ path: path.join(__dirname, "router.jsx") }));
      build.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: path.join(__dirname, "../mobile-versions-ui/svg.jsx") }));
      build.onResolve({ filter: /\/auth\/context$/ }, () => ({ path: path.join(__dirname, "context.jsx") }));
      build.onResolve({ filter: /\/drafts\/native$/ }, () => ({ path: path.join(__dirname, "tools.jsx") }));
    } }] });
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage();
  try {
    await page.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("https://fixture.test"); await page.addScriptTag({ content: built.outputFiles[0].text, type: "module" });
    stage = "access-and-create";
    await page.getByText("草稿箱", { exact: true }).click();
    await page.getByRole("button", { name: "恢复并继续", exact: true }).click();
    await page.getByRole("button", { name: "新建中篇", exact: true }).click();
    await page.getByRole("textbox", { name: "草稿标题" }).fill("合成 UI 草稿");
    await page.getByRole("textbox", { name: "草稿正文" }).fill("中文😀和合成多行\n续写");
    await page.getByText("已暂存本机，待同步", { exact: true }).waitFor();
    stage = "reopen";
    await page.getByRole("button", { name: "草稿箱", exact: true }).click();
    await page.getByText("合成 UI 草稿", { exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "草稿正文" }).inputValue(), "中文😀和合成多行\n续写");
    stage = "write-failure-and-return";
    await page.evaluate(() => { window.draftUi.failStore = true; });
    await page.getByRole("textbox", { name: "草稿正文" }).fill("暂存失败也保留输入");
    await page.getByText("本机暂存失败，请重试；先不要关闭页面。", { exact: true }).waitFor();
    stage = "locked-input-recovery";
    await page.evaluate(async () => {
      await window.draftUi.session.logout();
      await window.draftUi.session.signIn("login", "b@example.test", "fixture-password");
    });
    assert.equal(await page.getByRole("textbox", { name: "草稿正文" }).count(), 0);
    await page.getByRole("button", { name: "切换账号", exact: true }).click();
    await page.getByRole("textbox", { name: "邮箱", exact: true }).fill("a@example.test");
    await page.getByLabel("密码", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    await page.getByRole("button", { name: "恢复并继续", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "草稿正文" }).inputValue(), "暂存失败也保留输入");
    await page.getByRole("button", { name: "草稿箱", exact: true }).click();
    await page.getByRole("dialog", { name: "文字尚未暂存" }).waitFor();
    await page.evaluate(() => { window.draftUi.failStore = false; });
    await page.getByRole("button", { name: "重试暂存", exact: true }).click();
    await page.getByText("已暂存本机，待同步", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "草稿正文" }).inputValue(), "暂存失败也保留输入");
    stage = "uncertain-sync";
    await page.evaluate(() => { window.draftUi.online = true; window.draftUi.drop = true; });
    await page.getByRole("button", { name: "同步", exact: true }).click();
    await page.getByText("已暂存本机，服务器结果待确认", { exact: true }).waitFor();
    await page.getByRole("button", { name: "同步", exact: true }).click();
    await page.getByText("已保存到服务器", { exact: true }).waitFor();
    stage = "local-conflict-copy";
    const beforeCopy = await page.evaluate(async () => {
      window.draftUi.online = false;
      const row = (await window.draftUi.tools.local.list())[0];
      await window.draftUi.tools.local.edit(row.id, row.seq, "另一窗口合成", "另一窗口已存文字");
      return row.id;
    });
    await page.getByRole("textbox", { name: "草稿正文" }).fill("当前窗口需要另存的文字");
    await page.getByRole("button", { name: "另存本机副本", exact: true }).click();
    await page.waitForFunction(old => !window.draftUi.route.endsWith(old), beforeCopy);
    assert.equal(await page.getByRole("textbox", { name: "草稿正文" }).inputValue(), "当前窗口需要另存的文字");
    assert.equal(await page.evaluate(async key => (await window.draftUi.tools.local.load(key)).content, beforeCopy), "另一窗口已存文字");
    stage = "logout-and-isolation";
    await page.evaluate(() => { window.draftUi.online = false; });
    await page.getByRole("textbox", { name: "草稿正文" }).fill("仍待同步的合成文字");
    await page.getByText("已暂存本机，待同步", { exact: true }).waitFor();
    await page.getByRole("button", { name: "草稿箱", exact: true }).click();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByText("还有未同步草稿", { exact: true }).waitFor();
    // Changing identity closes the old count prompt before it can act on a
    // different account; then re-enter the original account to finish logout.
    await page.evaluate(async () => { await window.draftUi.session.logout(); });
    await page.getByText("游客", { exact: true }).waitFor();
    assert.equal(await page.getByText("还有未同步草稿", { exact: true }).count(), 0);
    await page.evaluate(async () => {
      await window.draftUi.session.signIn("login", "a@example.test", "fixture-password");
      await window.draftUi.session.confirmDraftAccess();
    });
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByText("还有未同步草稿", { exact: true }).waitFor();
    await page.getByRole("button", { name: "保留并退出", exact: true }).click();
    await page.getByText("游客", { exact: true }).waitFor();
    await page.evaluate(async () => { await window.draftUi.session.signIn("login", "b@example.test", "fixture-password"); });
    await page.getByText("草稿箱", { exact: true }).click();
    await page.getByRole("button", { name: "恢复并继续", exact: true }).click();
    await page.getByText("还没有本机草稿", { exact: true }).waitFor();
    assert.equal(await page.getByText("合成 UI 草稿", { exact: true }).count(), 0);
    console.log("PASS mobile drafts route/component fixtures; native storage and lifecycle not claimed.");
  } finally { await browser.close(); }
})().catch(error => { console.error("FAIL mobile drafts fixture stage=" + stage + " kind=" + (error?.name === "TimeoutError" ? "timeout" : "assertion_or_build")); process.exitCode = 1; });
