import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import AuthorWorks from "../../mobile/src/screens/AuthorWorksScreen.tsx";
import Publish from "../../mobile/src/app/publish.tsx";
import { session } from "./context.jsx";
window.publishUi = {
  session,
  journal: new Map(),
  blocked: false,
  failStore: false,
};
function Harness() {
  const [route, setRoute] = useState("/my-works");
  window.publishUi.navigate = setRoute;
  return route === "/my-works" ? <AuthorWorks /> : <Publish />;
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
