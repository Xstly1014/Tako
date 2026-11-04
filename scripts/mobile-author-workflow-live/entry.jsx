import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import AuthorWorks from "../../mobile/src/screens/AuthorWorksScreen.tsx";
import AuthorAppeals from "../../mobile/src/screens/AuthorAppealsScreen.tsx";
import Publish from "../../mobile/src/app/publish.tsx";
import DirectedAuthorWork from "../../mobile/src/app/my-works/[id].tsx";
import Reader from "../../mobile/src/screens/ReaderScreen.tsx";
import AuthorFeedback from "../../mobile/src/app/my-work-feedback/[id].tsx";
import FeedbackInbox from "../../mobile/src/app/author-feedback.tsx";
import { session } from "../mobile-author-works-ui/context.jsx";
import { PageScope, guards } from "./router.jsx";
window.authorWorkflow = { session, stack: [], paths: [] };
window.publishUi = { journal: new Map(), failStore: false };
function Harness() {
  const [stack, setStack] = useState([
    { key: crypto.randomUUID(), path: "/my-works", params: {} },
  ]);
  window.authorWorkflow.stack = stack;
  window.authorWorkflow.navigate = (mode, target) => {
    const path = typeof target === "string" ? target : target?.pathname;
    const entry = {
      key: crypto.randomUUID(),
      path,
      params: typeof target === "object" ? (target.params ?? {}) : {},
    };
    let next;
    if (mode === "push") next = [...stack, entry];
    else if (mode === "back") next = stack.slice(0, -1);
    else if (mode === "replace") next = [...stack.slice(0, -1), entry];
    else {
      const index = stack.map((x) => x.path).lastIndexOf(path);
      next =
        index < 0 ? [...stack.slice(0, -1), entry] : stack.slice(0, index + 1);
    }
    const removed = stack.filter((old) => !next.some((x) => x.key === old.key));
    const commit = () => {
      window.authorWorkflow.paths.push(next.at(-1)?.path);
      setStack(next);
    };
    const guard = removed.map((x) => guards.get(x.key)).find(Boolean);
    if (guard) guard({ repeat: commit });
    else commit();
  };
  return stack.map((entry, index) => (
    <section
      key={entry.key}
      hidden={index !== stack.length - 1}
      data-workflow-page={entry.path}
    >
      <PageScope value={{ ...entry, focused: index === stack.length - 1 }}>
        {entry.path === "/my-works" ? (
          <AuthorWorks />
        ) : entry.path === "/my-works/[id]" ? (
          <DirectedAuthorWork />
        ) : entry.path === "/my-moderation" ? (
          <AuthorAppeals />
        ) : entry.path === "/my-work-feedback/[id]" ? (
          <AuthorFeedback />
        ) : entry.path === "/author-feedback" ? (
          <FeedbackInbox />
        ) : entry.path === "/works/[id]" ? (
          <Reader />
        ) : entry.path === "/publish" ? (
          <Publish />
        ) : (
          <span>Unexpected route</span>
        )}
      </PageScope>
    </section>
  ));
}
(async () => {
  await session.restore();
  await session.signIn(
    "login",
    window.workflowFixture.author.email,
    window.workflowFixture.author.password,
  );
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
})();
