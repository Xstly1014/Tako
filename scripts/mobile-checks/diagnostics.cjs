// Treat child output as private. Only project fixed enums and approved locations.
function processState(result) {
  const reasons = {
    ENOENT: 'executable_missing', EACCES: 'access_denied', EPERM: 'access_denied',
    ETIMEDOUT: 'timeout', ENOBUFS: 'output_limit',
  };
  const reason = result.error ? (Object.hasOwn(reasons, result.error.code) ? reasons[result.error.code] : 'runner_error')
    : result.signal ? 'terminated' : 'nonzero_exit';
  return `exit=${Number.isInteger(result.status) ? result.status : 'none'} reason=${reason}`;
}

function testLocations(output, files) {
  const known = new Set(files), locations = new Set();
  for (const match of String(output).matchAll(/^\s+location: ['"]?[^\r\n]*?([a-z0-9-]+\.test\.ts):(\d+):(\d+)['"]?\s*$/gm)) {
    if (known.has(match[1])) locations.add(`${match[1]}:${Number(match[2])}:${Number(match[3])}`);
    if (locations.size === 8) break;
  }
  return [...locations];
}

const stages = {
  comments: ['build', 'open', 'guest-input', 'login', 'transfer', 'private-records'],
  versions: ['bundle', 'closed-metadata', 'read-open-version', 'failed-switch', 'stale-switch', 'paging-retry', 'restricted-node'],
  author: ['bundle', 'session-envelope', 'lost-response', 'restricted-restore', 'conflict', 'read-failure', 'confirmed-action-read-retry',
    'offline-grant-blocks-management', 'online-grant-restores-management', 'account-switch'],
  publication: ['bundle', 'session-envelope', 'incomplete-editor-handoff', 'unconfirmed-editor-revision', 'confirmed-old-editor-revision',
    'authorization-and-snapshot', 'storage-failure', 'unknown-result', 'remount-read-only',
    'offline-grant-blocks-publication', 'online-grant-restores-journal',
    'replacement-read-failure', 'replacement-read-retry', 'confirmed-state-read-retry',
    'management-return-target', 'management-account-stack', 'management-direct-entry', 'management-journal-return', 'account-switch'],
};
const markers = {
  comments: /^Stage ([a-z-]+);/m,
  versions: /^Version component stage: ([a-z-]+);/m,
  author: /^Author fixture failed at ([a-z-]+):/m,
  publication: /^Publication fixture failed at ([a-z-]+):/m,
};
function fixtureStage(mode, output) {
  const stage = String(output).match(markers[mode])?.[1];
  return stages[mode]?.includes(stage) ? stage : 'unavailable';
}

module.exports = { processState, testLocations, fixtureStage };
