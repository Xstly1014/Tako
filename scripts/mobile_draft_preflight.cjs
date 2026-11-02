// Real native draft contract preflight on local test3300 only.
// Creates synthetic accounts/private drafts; no mail, production or existing user data.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const base = 'http://127.0.0.1:3300/api';
let stage = 'environment';
async function call(route, { method = 'GET', body, token } = {}, expected = 200) {
  const response = await fetch(base + route, { method, signal: AbortSignal.timeout(15000), credentials: 'omit',
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.headers.get('X-Tako-Environment'), 'test', 'test environment required');
  assert.equal(response.status, expected, 'unexpected HTTP status');
  return response.status === 204 ? undefined : response.json();
}
async function author(label) {
  const value = await call('/app/auth/register', { method: 'POST', body: {
    email: 'draft-preflight-' + randomUUID() + '@example.test', password: randomUUID(),
  } });
  assert.equal(value.token_type, 'Bearer');
  await call('/me', { method: 'PATCH', token: value.access_token, body: { nickname: '合成草稿预检' + label } });
  return value.access_token;
}
(async () => {
  await call('/community');
  const tokens = [];
  try {
    stage = 'synthetic-authors';
    tokens.push(await author('甲'));
    tokens.push(await author('乙'));
    const [a, b] = tokens;
    stage = 'create-and-confirm-original';
    const create = { mutation_id: randomUUID(), title: 'App草稿合成预检', content: '第一份合成文字。' };
    const first = await call('/drafts/create', { method: 'POST', token: a, body: create });
    // Model a response lost after commit: repeat the exact durable request.
    assert.deepEqual(await call('/drafts/create', { method: 'POST', token: a, body: create }), first);
    assert.equal((await call('/drafts', { token: a })).items.filter((x) => x.id === first.draft_id).length, 1);
    const reused = await call('/drafts/create', { method: 'POST', token: a, body: { ...create, content: '不同的合成载荷。' } }, 409);
    assert.equal(reused.error, 'mutation_id_reused');
    stage = 'save-and-ownership';
    const update = { mutation_id: randomUUID(), draft_id: first.draft_id, base_revision: first.revision,
      title: create.title, content: '电脑先保存的新版本。' };
    const saved = await call('/drafts/save', { method: 'POST', token: a, body: update });
    assert.deepEqual(await call('/drafts/save', { method: 'POST', token: a, body: update }), saved);
    assert.equal((await call('/drafts/' + first.draft_id, { token: a })).content, update.content);
    await call('/drafts/' + first.draft_id, { token: b }, 404);
    await call('/drafts/save', { method: 'POST', token: b, body: { ...update, mutation_id: randomUUID(), base_revision: saved.revision } }, 404);
    assert.equal((await call('/drafts', { token: b })).items.length, 0);
    stage = 'conflict-and-recovery';
    const offline = { ...update, mutation_id: randomUUID(), content: '手机离线续写的独立版本。' };
    const conflict = await call('/drafts/save', { method: 'POST', token: a, body: offline }, 409);
    assert.equal(conflict.error, 'revision_conflict');
    const recover = { ...offline, mutation_id: randomUUID() };
    const copy = await call('/drafts/recover', { method: 'POST', token: a, body: recover });
    assert.notEqual(copy.draft_id, first.draft_id);
    assert.deepEqual(await call('/drafts/recover', { method: 'POST', token: a, body: recover }), copy);
    assert.equal((await call('/drafts/' + copy.draft_id, { token: a })).content, offline.content);
    assert.equal((await call('/drafts/' + first.draft_id, { token: a })).content, update.content);
    const list = await call('/drafts', { token: a });
    assert.equal(list.items.length, 2);
    assert.equal(list.items.find((x) => x.id === copy.draft_id).recovered_from, first.draft_id);
    await call('/drafts/recover', { method: 'POST', token: b, body: { ...recover, mutation_id: randomUUID() } }, 404);
    stage = 'recovery-follow-up-save';
    const next = await call('/drafts/save', { method: 'POST', token: a, body: {
      ...offline, mutation_id: randomUUID(), draft_id: copy.draft_id, base_revision: copy.revision,
      content: '手机副本确认后继续写的文字。',
    } });
    assert.equal(next.draft_id, copy.draft_id);
    assert.equal((await call('/drafts/' + first.draft_id, { token: a })).revision, saved.revision);
    console.log('PASS native draft preflight: create/save receipt replay, payload reuse rejection, private ownership, conflict preserves original, one recovery copy and independent continuation. Not local encryption or App UI/device evidence.');
  } finally {
    for (const token of tokens) await call('/app/auth/logout', { method: 'POST', token, body: {} }, 204);
  }
})().catch((error) => {
  // Never print HTTP responses, credentials or draft text on failure.
  console.error('Draft preflight failed at ' + stage + ': ' + error.name);
  process.exit(1);
});
