import { useSyncExternalStore } from "react";
import { Session } from "../../mobile/src/auth/session.ts";
import { request } from "../../mobile/src/api/client.ts";
import { createDraftSessionVault } from "../../mobile/src/drafts/access.ts";
let secureValue = null;
export const session = new Session(
  createDraftSessionVault({
    get: async () => secureValue,
    set: async (value) => {
      secureValue = value;
    },
    remove: async () => {
      secureValue = null;
    },
  }),
  request,
);
export function useSession() {
  return {
    ...useSyncExternalStore(session.subscribe, session.snapshot),
    session,
  };
}
