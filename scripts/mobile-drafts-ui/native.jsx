export * from "../mobile-comments-ui/native.jsx";
export const AppState = { currentState: "active", addEventListener(_event, callback) {
  const listeners = window.draftUi.listeners; listeners.add(callback);
  return { remove() { listeners.delete(callback); } };
} };
