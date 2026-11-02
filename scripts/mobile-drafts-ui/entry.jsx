import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Account from "../../mobile/src/app/account.tsx";
import Drafts from "../../mobile/src/app/drafts/index.tsx";
import Editor from "../../mobile/src/app/drafts/[id].tsx";
import { session } from "./context.jsx";
import Novels from "../../mobile/src/app/novels.tsx";
import Publish from "../../mobile/src/app/publish.tsx";
import { RouteContext } from "./router.jsx";
import { fixtureHttp, advanceServer, nativeDraftTools } from "./tools.jsx";
window.draftUi = { session, history: [], route: "/account", listeners: new Set(), online: false,
  failStore: false, blocked: false, drop: false, tools: nativeDraftTools(), journal: new Map(), http: fixtureHttp, advanceServer };
function Harness() {
  const [route, setRoute] = useState("/account"); window.draftUi.navigate = setRoute;
  const editorPath = route.startsWith("/drafts/") ? route : route.startsWith("/publish") ? [...window.draftUi.history].reverse().find(x => x.startsWith("/drafts/")) : null;
  return <>
    {route === "/account" ? <RouteContext.Provider value={route}><Account /></RouteContext.Provider> : null}
    {route === "/novels" ? <RouteContext.Provider value={route}><Novels /></RouteContext.Provider> : null}
    {route === "/drafts" ? <RouteContext.Provider value={route}><Drafts /></RouteContext.Provider> : null}
    {editorPath ? <RouteContext.Provider value={editorPath}><div hidden={route !== editorPath}><Editor key={editorPath} /></div></RouteContext.Provider> : null}
    {route.startsWith("/publish") ? <RouteContext.Provider value={route}><div id="publication-frame"><Publish key={route} /></div></RouteContext.Provider> : null}
  </>;
}
(async () => { await session.restore(); await session.signIn("login", "a@example.test", "fixture-password");
  createRoot(document.getElementById("root")).render(<Harness />); })();
