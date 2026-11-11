import * as SecureStore from "expo-secure-store";
import { ApiError } from "../api/client";
import { UUID } from "../api/reader";
import type { JournalStore } from "./flow";
// Only operation metadata (< 1 KiB), never source text or credentials.
function accountJournal(scope: string, accountId: string): JournalStore {
  if (!UUID.test(accountId)) throw new ApiError("authentication_required");
  const key = `tako.${scope}.v1.${accountId}`;
  return {
    get: () => SecureStore.getItemAsync(key),
    set: (value) => {
      if (value.length > 1024) return Promise.reject(new ApiError("storage"));
      return SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    remove: () => SecureStore.deleteItemAsync(key),
  };
}

export const publicationJournal = (id: string) => accountJournal("publication", id);
export const workSubmissionJournal = (id: string) => accountJournal("work-submission-withdrawal", id);
export const shortPostJournal = (id: string) => accountJournal("short-post-submission", id);
