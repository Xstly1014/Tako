import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import * as SecureStore from "expo-secure-store";
import { request } from "../api/client";
import { Session } from "./session";
const key = "tako.test.app.session.v1";
const session = new Session(
  {
    get: () => SecureStore.getItemAsync(key),
    set: (value) =>
      SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    remove: () => SecureStore.deleteItemAsync(key),
  },
  request,
);
const Context = createContext(session);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void session.restore();
  }, []);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useSession() {
  const session = useContext(Context);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  return { session, ...state };
}
