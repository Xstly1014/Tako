import { useSyncExternalStore } from "react";
import { Session } from "../../mobile/src/auth/session.ts";
import { request } from "../../mobile/src/api/client.ts";
let token = null;
export const session = new Session(
  {
    get: async () => token,
    set: async (value) => {
      token = value;
    },
    remove: async () => {
      token = null;
    },
  },
  request,
);
export function useSession() {
  return {
    ...useSyncExternalStore(session.subscribe, session.snapshot),
    session,
  };
}
