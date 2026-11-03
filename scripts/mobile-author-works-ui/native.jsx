export * from "../mobile-comments-ui/native.jsx";
// Never opens an external mail application during component checks.
export const Linking = { openURL: async url => {
  window.authorUi.lastContact = url;
  if (window.authorUi.failContact) throw new Error("mail_app_unavailable");
} };
