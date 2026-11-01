export type FavoriteState = { work_id: string; favorite: boolean; revision: number }
export type FavoriteChange = { mutation_id: string; expected_account_id: string; expected_revision: number; favorite: boolean }
export type FavoriteEntry = { work_id: string; revision: number; saved_at: string; work: import('./discovery').WorkCard | null }
export type FavoritePage = { items: FavoriteEntry[]; next_cursor: string }
export function signedInForFeedback() {
  try { localStorage.removeItem('tako-session-locked') } catch { /* Server session remains authoritative. */ }
  if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('tako-session'); channel.postMessage('session-changed'); channel.close() }
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('tako-session-updated'))
}
