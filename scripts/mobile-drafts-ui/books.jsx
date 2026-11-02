// Route-entry adapter only; encrypted persistence is tested with real SQLite/AES.
const pending=new Map();
export function nativeBookJournal(session){const owner=session.snapshot().account.id;return {async load(){return pending.get(owner)??null;},async save(value){pending.set(owner,value);}};}
