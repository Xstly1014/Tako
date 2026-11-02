// Component composition test with DOM adapters and deterministic service fixtures.
// Does NOT validate Android layout, IME, native navigation or real authentication.
const esbuild = require("/tools/node_modules/esbuild");
const { chromium } = require("/tools/node_modules/playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const dir = __dirname,
  root = path.resolve(dir, "../..");
require("node:fs").mkdirSync(path.join(root, ".runtime/mobile/qa"), {
  recursive: true,
});
let stage = "build";
(async () => {
  const built = await esbuild.build({
    entryPoints: [path.join(dir, "entry.jsx")],
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
        name: "test-platform",
        setup(build) {
          build.onResolve(
            { filter: /^react-native$|^react-native-safe-area-context$/ },
            () => ({ path: path.join(dir, "native.jsx") }),
          );
          build.onResolve({ filter: /^expo-router$/ }, () => ({
            path: path.join(dir, "router.jsx"),
          }));
          build.onResolve({ filter: /\/auth\/context$/ }, () => ({
            path: path.join(dir, "context.jsx"),
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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.route("**/__comments_component", (route) =>
      route.fulfill({
        contentType: "text/html",
        body:
          '<div id="root"></div><script type="module">' +
          built.outputFiles[0].text.replaceAll("</script", "<\\/script") +
          "</script>",
      }),
    );
    await page.route("**/api/works/*/comments?*", (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: { "X-Tako-Environment": "test" },
        body: JSON.stringify({ items: [], next: 0 }),
      }),
    );
    stage = "open";
    await page.goto("http://127.0.0.1:3300/__comments_component");
    const input = page.getByRole("textbox", { name: "评论正文" });
    stage = "guest-input";
    await input.fill("游客未发表文字");
    await page.getByRole("button", { name: "收起评论", exact: true }).click();
    await page.getByRole("button", { name: "测试打开评论" }).click();
    assert.equal(await input.inputValue(), "游客未发表文字");
    stage = "login";
    await page.getByRole("button", { name: "登录后发表" }).click();
    await page
      .getByRole("textbox", { name: "邮箱", exact: true })
      .fill("a@example.test");
    await page.getByLabel("密码", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "登录账号", exact: true }).click();
    stage = "transfer";
    await page
      .getByText("将刚才的游客文字带入当前账号？", { exact: true })
      .waitFor();
    assert.equal(await input.inputValue(), "");
    assert.equal(
      await page.evaluate(() => window.componentTest.stats().attempts),
      0,
    );
    await page.getByRole("button", { name: "保留文字" }).click();
    await page.getByRole("textbox", { name: "评论笔名" }).fill("测试甲");
    await page.getByRole("button", { name: "保存笔名", exact: true }).click();
    await page
      .getByRole("textbox", { name: "评论笔名" })
      .waitFor({ state: "detached" });
    assert.equal(await input.inputValue(), "游客未发表文字");
    await page.evaluate(() => window.componentTest.dropNext());
    await page.getByRole("button", { name: "发表", exact: true }).click();
    await page.getByRole("button", { name: "检查原发表" }).waitFor();
    assert.equal(await input.inputValue(), "游客未发表文字");
    await page.getByRole("button", { name: "检查原发表" }).click();
    await page.getByText("评论已发表。", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "");
    assert.deepEqual(await page.evaluate(() => window.componentTest.stats()), {
      attempts: 2,
      unique: 1,
    });
    const mine = page
      .getByText("游客未发表文字", { exact: true })
      .locator("..");
    await mine.getByRole("button", { name: "删除", exact: true }).click();
    await page
      .getByRole("dialog", { name: "删除评论" })
      .getByText("主评论和全部回复将一起删除，无法恢复。", { exact: true })
      .waitFor();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await page.getByText("评论已删除。", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("游客未发表文字", { exact: true }).count(),
      0,
    );
    const peer = page
      .getByText("已有主评论正文", { exact: true })
      .locator("..");
    await peer.getByRole("button", { name: "回复", exact: true }).click();
    await input.fill("一条回复");
    await page.getByRole("button", { name: "发表", exact: true }).click();
    await page.getByText("评论已发表。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "查看回复", exact: true }).click();
    await page.getByText("一条回复", { exact: true }).waitFor();
    await input.fill("甲账号的私有未发表文字");
    await page.evaluate(() => window.componentTest.switchB());
    await page.waitForFunction(
      () => document.querySelector("textarea")?.value === "",
    );
    assert.equal(await input.inputValue(), "");
    assert.equal(await page.evaluate(() => window.componentTest.dirty), false);
    assert.deepEqual(errors, []);
    stage = "private-records";
    await page.evaluate(async () => {
      const s = window.componentTest.session;
      await s.logout();
      await s.signIn("login", "a@example.test", "fixture-password");
      window.componentTest.privateReason();
      window.componentTest.showMine();
    });
    await page.getByText("处置原因：仅甲可见", { exact: true }).waitFor();
    await page.evaluate(() => window.componentTest.switchB());
    await page.getByText("已有主评论正文", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("处置原因：仅甲可见", { exact: true }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS component fixtures: collapse preserves input; guest transfer and nickname; lost-response retry; root delete confirmation; reply; account switch clears input and private moderation reason. Not native-device evidence.",
    );
  } catch (e) {
    console.error("Stage " + stage + "; page errors " + JSON.stringify(errors));
    await page.screenshot({
      path: root + "/.runtime/mobile/qa/comments-component-failure.png",
      fullPage: true,
    });
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("Comment component test failed: " + e.name);
  process.exit(1);
});
