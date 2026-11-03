// One real, loopback-only business scenario. Child output is private by default.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const {
  processState,
  authorWorkflowStage,
} = require("./mobile-checks/diagnostics.cjs");
const root = path.resolve(__dirname, "..");
async function main() {
  process.env.EXPO_PUBLIC_API_URL = "http://127.0.0.1:3300/api";
  const { request } = await import("../mobile/src/api/client.ts");
  const { Session } = await import("../mobile/src/auth/session.ts");
  const { AuthorWorksApi } = await import("../mobile/src/api/author-works.ts");
  const { catalogFixture } = await import(
    "../mobile/tests/helpers/catalog-fixture.ts"
  );
  const response = await fetch("http://127.0.0.1:3300/api/community", {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || response.headers.get("X-Tako-Environment") !== "test")
    throw Error("local_test_environment_required");
  const createSession = () => {
    let token = null;
    return new Session(
      {
        get: async () => token,
        set: async (x) => {
          token = x;
        },
        remove: async () => {
          token = null;
        },
      },
      request,
    );
  };
  const author = createSession(),
    reader = createSession();
  const suffix = randomUUID(),
    prefix = "联调" + suffix.slice(0, 8);
  const fixture = {
    author: {
      email: `catalog-workflow-${suffix}@example.test`,
      password: randomUUID(),
    },
    reader: {
      email: `workflow-reader-${suffix}@example.test`,
      password: randomUUID(),
    },
    prefix,
    title: prefix + "原版",
    nextTitle: prefix + "修订版",
  };
  const directory = fs.mkdtempSync(
    path.join(root, ".runtime/author-workflow-"),
  );
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "tako-workflow-modules-"),
  );
  const relative = path.relative(root, directory).split(path.sep).join("/");
  let catalog;
  try {
    await author.signIn(
      "register",
      fixture.author.email,
      fixture.author.password,
    );
    await author.setNickname("联调作者");
    await reader.signIn(
      "register",
      fixture.reader.email,
      fixture.reader.password,
    );
    await reader.setNickname("联调读者");
    catalog = catalogFixture(author.snapshot().account.id);
    const draft = await author.authorized("/drafts/create", {
      method: "POST",
      body: {
        mutation_id: randomUUID(),
        title: fixture.title,
        content: "整链路正式原稿。\n中文与表情😀完整结尾。",
      },
    });
    fixture.draftId = draft.draft_id;
    fs.writeFileSync(
      path.join(directory, "fixture.json"),
      JSON.stringify(fixture),
      { mode: 0o600 },
    );
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "tako-local-test_default",
        "-v",
        root + ":/materials:ro",
        "-v",
        "writing-community_frontend_modules:/tools/node_modules:ro",
        "-v",
        "tako-mobile-node-modules:/app/node_modules:ro",
        "-v",
        scratch + ":/materials/mobile/node_modules:ro",
        "-e",
        "WORKFLOW_FIXTURE=/materials/" + relative + "/fixture.json",
        "-w",
        "/tools",
        "mcr.microsoft.com/playwright:v1.56.1-noble",
        "node",
        "/materials/scripts/mobile-author-workflow-live/run.cjs",
      ],
      { cwd: root, encoding: "utf8", timeout: 240000 },
    );
    if (result.status !== 0 || result.error) {
      console.error(
        "DIAG author-workflow " +
          processState(result) +
          " stage=" +
          authorWorkflowStage(result.stderr),
      );
      const line = String(result.stderr).match(/^workflow_line=(\d+)$/m)?.[1];
      if (line) console.error("DIAG author-workflow line=" + Number(line));
      for (const match of String(result.stderr).matchAll(
        /^workflow_(phase=(?:loading|guest|ready|offline)|code=(?:rate_limited|origin_rejected|invalid_login|network|environment)|requests=(?:(?:auth|catalog|other):\d{3},?)*|page_errors=\d+)$/gm,
      ))
        console.error("DIAG " + match[0]);
      throw Error("author_workflow_failed");
    }
    if (!String(result.stdout).includes("PASS real author workflow"))
      throw Error("author_workflow_missing_completion");
  } finally {
    // Clean only this run's historical fixture; normal audit records remain.
    let cleanupFailed = false;
    if (author.snapshot().phase === "ready") {
      const api = new AuthorWorksApi((p, o) => author.authorized(p, o));
      try {
        const page = await api.catalog({
          q: prefix,
          visibility: "all",
          restriction: "all",
        });
        for (const item of page.items) {
          const { state } = await api.timeline(item.id);
          if (!state.author_hidden)
            await api.change(item.id, {
              mutation_id: randomUUID(),
              expected_state_revision: state.state_revision,
              action: "hide",
            });
        }
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      catalog?.cleanup();
    } catch {
      cleanupFailed = true;
    }
    for (const session of [author, reader])
      if (session.snapshot().phase === "ready")
        try {
          await session.logout();
        } catch {
          cleanupFailed = true;
        }
    // Both generated absolute paths were created within known task directories.
    if (
      path.dirname(directory) !== path.join(root, ".runtime") ||
      !path.basename(directory).startsWith("author-workflow-")
    )
      throw Error("unsafe_fixture_path");
    if (
      path.dirname(scratch) !== os.tmpdir() ||
      !path.basename(scratch).startsWith("tako-workflow-modules-")
    )
      throw Error("unsafe_scratch_path");
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    if (cleanupFailed) throw Error("workflow_cleanup_failed");
  }
  console.log("PASS real author workflow (real HTTP/MySQL and DOM adapters; not native-device evidence).");
}
main().catch((error) => {
  const codes = [
    "local_test_environment_required",
    "author_workflow_failed",
    "author_workflow_missing_completion",
    "unsafe_fixture_path",
    "unsafe_scratch_path",
    "workflow_cleanup_failed",
  ];
  if (error.code === "rate_limited")
    console.error("DIAG workflow_code=rate_limited");
  console.error(
    "FAIL author workflow: " +
      (codes.includes(error.message)
        ? error.message
        : "setup_service_or_cleanup_failed"),
  );
  process.exitCode = 1;
});
