import { useEffect } from "react";
function go(path, replace = false) {
  if (!replace) window.draftUi.history.push(window.draftUi.route);
  window.draftUi.route = path;
  window.draftUi.navigate(path);
}
export const router = {
  push: path => go(typeof path === "string" ? path : path.pathname),
  replace: path => go(path, true), canGoBack: () => window.draftUi.history.length > 0,
  back() {
    if (window.draftUi.blocked) { window.draftUi.prevent?.({ repeat: () => { const path = window.draftUi.history.pop() ?? "/account"; go(path, true); } }); return; }
    const path = window.draftUi.history.pop() ?? "/account"; go(path, true);
  },
};
export const useIsFocused = () => true;
export const useLocalSearchParams = () => ({ id: window.draftUi.route.split("/")[2] });
export function useFocusEffect(callback) { useEffect(callback, [callback]); }
export function usePreventRemove(blocked, callback) {
  useEffect(() => { window.draftUi.blocked = blocked; window.draftUi.prevent = callback;
    return () => { window.draftUi.blocked = false; }; }, [blocked, callback]);
  return () => { window.draftUi.blocked = false; };
}
