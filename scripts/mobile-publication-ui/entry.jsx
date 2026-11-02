import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import AuthorWorks from "../../mobile/src/screens/AuthorWorksScreen.tsx";
import Publish from "../../mobile/src/app/publish.tsx";
import Account from "../../mobile/src/app/account.tsx";
import { session } from "./context.jsx";
window.publishUi = {
  session,
  journal: new Map(),
  blocked: false,
  failStore: false,
};
function Harness() {
  const [history, setHistory] = useState(["/account", "/my-works"]);
  window.publishUi.history = history;
  window.publishUi.navigate = (path, mode = "replace") => setHistory(old => {
    if (mode === "back") return old.length > 1 ? old.slice(0, -1) : old;
    if (mode === "push") return [...old, path];
    if (mode === "dismissTo") {
      const index = old.lastIndexOf(path);
      if (index >= 0) return old.slice(0, index + 1);
    }
    return [...old.slice(0, -1), path];
  });
  const route = history.at(-1);
  return route === "/account" ? <Account /> : route === "/my-works" ? <AuthorWorks /> : <Publish />;
}
(async () => {
  await session.restore();
  await session.signIn("login", "a@example.test", "fixture-password");
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
})();
