import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Account from "../../mobile/src/app/account.tsx";
import Drafts from "../../mobile/src/app/drafts/index.tsx";
import Editor from "../../mobile/src/app/drafts/[id].tsx";
import { session } from "./context.jsx";
import { nativeDraftTools } from "./tools.jsx";
window.draftUi = { session, history: [], route: "/account", listeners: new Set(), online: false,
  failStore: false, blocked: false, drop: false, tools: nativeDraftTools() };
function Harness() {
  const [route, setRoute] = useState("/account"); window.draftUi.navigate = setRoute;
  return route === "/account" ? <Account /> : route === "/drafts" ? <Drafts /> : <Editor key={route} />;
}
(async () => { await session.restore(); await session.signIn("login", "a@example.test", "fixture-password");
  createRoot(document.getElementById("root")).render(<Harness />); })();
