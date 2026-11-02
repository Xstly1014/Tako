export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = "fixture-only";
export const getItemAsync = async key => window.draftUi.journal.get(key) ?? null;
export const setItemAsync = async (key, value) => { window.draftUi.journal.set(key, value); };
export const deleteItemAsync = async key => { window.draftUi.journal.delete(key); };
