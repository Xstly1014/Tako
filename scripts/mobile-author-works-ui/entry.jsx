import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import Account from "../../mobile/src/app/account.tsx";
import AuthorWorks from "../../mobile/src/screens/AuthorWorksScreen.tsx";
import { session } from "./context.jsx";
window.authorUi = { session, blocked: false };
function Harness() {
  const [route, setRoute] = useState("/account");
  window.authorUi.navigate = setRoute;
  return route === "/account" ? <Account /> : <AuthorWorks />;
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
