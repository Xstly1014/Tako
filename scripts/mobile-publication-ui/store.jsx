export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = "fixture-only";
export async function getItemAsync(key) {
  return window.publishUi.journal.get(key) ?? null;
}
export async function setItemAsync(key, value) {
  if (window.publishUi.failStore) {
    window.publishUi.failStore = false;
    throw Error("fixture_storage");
  }
  window.publishUi.journal.set(key, value);
}
export async function deleteItemAsync(key) {
  window.publishUi.journal.delete(key);
}
