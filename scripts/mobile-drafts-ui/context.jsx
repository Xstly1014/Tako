import { useSyncExternalStore } from "react";
import { Session } from "../../mobile/src/auth/session.ts";
import { createDraftSessionVault } from "../../mobile/src/drafts/access.ts";
let value = null;
const item = { get: async () => value, set: async next => { value = next; }, remove: async () => { value = null; } };
let account = { id: "22222222-2222-4222-8222-222222222222", nickname: "合成作者" };
export const session = new Session(createDraftSessionVault(item), async (path, options) => {
  if (path === "/me") return account;
  if (path.includes("logout")) return;
  account = { ...account, id: options.body.email.startsWith("b") ? "33333333-3333-4333-8333-333333333333" : "22222222-2222-4222-8222-222222222222" };
  return { account, access_token: "tako_app_" + "a".repeat(64), token_type: "Bearer", expires_in: 604800 };
}, async () => (await window.draftUi.tools.local.list()).filter(row => row?.dirty || row?.pending).length);
export function useSession() { return { session, ...useSyncExternalStore(session.subscribe, session.snapshot) }; }
