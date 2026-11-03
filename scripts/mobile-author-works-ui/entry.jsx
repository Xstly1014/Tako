import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import Account from "../../mobile/src/app/account.tsx";
import AuthorWorks from "../../mobile/src/screens/AuthorWorksScreen.tsx";
import AuthorAppeals from "../../mobile/src/screens/AuthorAppealsScreen.tsx";
import Inbox from "../../mobile/src/screens/AuthorFeedbackInboxScreen.tsx";
import { session } from "./context.jsx";
window.authorUi = { session, blocked: false };
function Harness() {
  const [route, setRoute] = useState("/account");
  window.authorUi.navigate = setRoute;
  return route === "/account" ? <Account /> : route === "/author-feedback" ? <Inbox /> : route === "/my-moderation" ? <AuthorAppeals /> : <AuthorWorks />;
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
