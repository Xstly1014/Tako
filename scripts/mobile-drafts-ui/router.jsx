import { createContext, useContext, useEffect } from "react";
export const RouteContext = createContext("/account");
const guards = new Map();
function go(path, replace = false) {
  if (!replace) window.draftUi.history.push(window.draftUi.route);
  window.draftUi.route = path; window.draftUi.navigate(path);
}
const pop = () => go(window.draftUi.history.pop() ?? "/account", true);
export const router = {
  push: path => go(typeof path === "string" ? path : path.pathname),
  replace: path => go(path, true), canGoBack: () => window.draftUi.history.length > 0,
  back() { const guard = guards.get(window.draftUi.route);
    if (guard?.blocked) { guard.callback?.({ repeat: pop }); return; } pop(); },
};
export const useIsFocused = () => useContext(RouteContext) === window.draftUi.route;
export function useLocalSearchParams() {
  const url = new URL(useContext(RouteContext), "https://fixture.test");
  const params = Object.fromEntries([...url.searchParams.keys()].map(key => [key, url.searchParams.getAll(key).length > 1 ? url.searchParams.getAll(key) : url.searchParams.get(key)]));
  if (url.pathname.startsWith("/drafts/")) params.id = url.pathname.split("/")[2];
  return params;
}
export function useFocusEffect(callback) {
  const focused = useIsFocused(); useEffect(() => focused ? callback() : undefined, [callback, focused]);
}
export function usePreventRemove(blocked, callback) {
  const path = useContext(RouteContext);
  useEffect(() => { guards.set(path, { blocked, callback }); return () => { guards.delete(path); }; }, [path, blocked, callback]);
  return () => guards.set(path, { blocked: false });
}
