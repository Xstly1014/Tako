// Render the actual RN catalog view with an explicit styled DOM adapter. Input is
// a saved owner-scoped real API catalog, never a credential file or mock server.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const esbuild = require("/tools/node_modules/esbuild"),
  { chromium } = require("/tools/node_modules/playwright");
(async () => {
  const root = path.resolve(__dirname, "../.."),
    input = process.env.LAYOUT_FIXTURE;
  if (!input || !input.startsWith("/materials/.runtime/"))
    throw Error("runtime_catalog_fixture_required");
  const pageData = JSON.parse(fs.readFileSync(input, "utf8"));
  assert.ok(pageData.items.length >= 4);
  for (const x of pageData.items)
    for (const k of ["comment_count", "favorite_count"])
      assert.ok(Number.isSafeInteger(x[k]) && x[k] >= 0);
  const output = "/materials/.runtime/mobile/qa/author-list-20261104";
  fs.mkdirSync(output, { recursive: true });
  const built = await esbuild.build({
    entryPoints: [path.join(__dirname, "entry.jsx")],
    bundle: true,
    write: false,
    format: "esm",
    jsx: "automatic",
    nodePaths: ["/app/node_modules"],
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx", target: "ES2022" } },
    define: {
      "process.env.NODE_ENV": '"development"',
      "process.env.EXPO_PUBLIC_API_URL": '"http://127.0.0.1:3300/api"',
    },
    plugins: [
      {
        name: "layout-dom",
        setup(b) {
          b.onResolve(
            { filter: /^react-native$|^react-native-safe-area-context$/ },
            () => ({ path: path.join(__dirname, "native.jsx") }),
          );
        },
      },
    ],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [
      [360, 640],
      [390, 844],
      [430, 932],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.name));
      await page.setContent(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,"Noto Sans CJK SC",sans-serif;color:#202631}#root{height:100dvh;padding-top:24px;padding-bottom:24px;display:flex;flex-direction:column}</style><div id="root"></div>',
      );
      await page.evaluate((data) => (window.catalogSnapshot = data), pageData);
      await page.addScriptTag({
        content: built.outputFiles[0].text,
        type: "module",
      });
      await page.getByRole("button", { name: "筛选", exact: true }).waitFor();
      assert.equal(
        await page.getByText(/展示 V|最新 V|最新正式标题/).count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "隐藏作品", exact: true })
          .count(),
        0,
      );
      for (const x of pageData.items)
        await page
          .getByRole("button", { name: "管理作品 " + x.title, exact: true })
          .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: path.join(output, `list-${width}x${height}.png`),
      });
      await page.getByRole("button", { name: "筛选", exact: true }).click();
      await page
        .getByRole("radio", { name: "作者已隐藏", exact: true })
        .click();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("button", { name: "筛选", exact: true }).click();
      await page
        .getByRole("radio", { name: "全部作者状态", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("radio", { name: "全部作者状态", exact: true })
          .getAttribute("aria-checked"),
        "true",
      );
      await page
        .getByRole("radio", { name: "作者已隐藏", exact: true })
        .click();
      await page.getByRole("radio", { name: "受限", exact: true }).click();
      await page.screenshot({
        path: path.join(output, `filters-${width}x${height}.png`),
      });
      const apply = await page
        .getByRole("button", { name: "应用筛选", exact: true })
        .boundingBox();
      assert.ok(apply.y >= 0 && apply.y + apply.height <= height);
      await page.getByRole("button", { name: "应用筛选", exact: true }).click();
      await page
        .getByRole("button", { name: "清空条件", exact: true })
        .waitFor();
      await page.evaluate(() => window.setLayoutScenario("empty"));
      await page.getByText("没有符合条件的作品", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        `PASS author catalog styled DOM ${width}x${height}; real API snapshot; no device claim`,
      );
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("FAIL author catalog layout: " + e.name);
  process.exitCode = 1;
});
