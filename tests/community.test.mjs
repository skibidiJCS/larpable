import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createHandler } from '../api/community.js';
import production from '../api/community.js';
import { localStore } from '../scripts/local-store.mjs';
import { redisStore, counterScript } from '../lib/counter.mjs';
import { verifyGoogleCredential } from '../lib/google-auth.mjs';

const origin = 'https://larpable.vercel.app';
const secret = 'test-secret-with-at-least-32-characters';
const clientId = 'test.apps.googleusercontent.com';
const sign = (value) => createHmac('sha256', secret).update(value).digest('base64url');
function setup(t) {
  const folder = mkdtempSync(join(tmpdir(), 'larpable-test-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'counter.json');
  const options = {
    store: localStore(file), secret, googleClientId: clientId,
    // Only tests inject a verifier. The production route always uses Google's library.
    async verifyCredential(credential, audience, nonce) {
      const [sub, suppliedNonce] = credential.split('|');
      assert.equal(audience, clientId);
      if (!sub.startsWith('google-user-') || suppliedNonce !== nonce) throw new Error('Invalid identity');
      return sub;
    },
  };
  return { handler: createHandler(options), options, file };
}
const get = (handler, cookie = '') => handler(new Request(`${origin}/api/community`, { headers: { Cookie: cookie } }));
function responseCookies(response) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}
async function session(handler) {
  const response = await get(handler);
  return { cookie: responseCookies(response), data: await response.json() };
}
function post(handler, session, sub = 'google-user-one', extra = {}) {
  return handler(new Request(`${origin}/api/community`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify({ credential: `${sub}|${session.data.nonce}`, ...extra }),
  }));
}

test('public count is readable, but anonymous requests cannot join', async (t) => {
  const { handler } = setup(t);
  const s = await session(handler);
  assert.equal(s.data.count, 0);
  assert.equal(s.data.joined, false);
  assert.equal(s.data.googleClientId, clientId);
  assert.equal((await post(handler, s, 'forged')).status, 401);
  assert.equal((await post(handler, { ...s, cookie: '' })).status, 401);
  assert.equal((await (await get(handler)).json()).count, 0);
});

test('one Google account counts once across incognito sessions and 50 simultaneous requests', async (t) => {
  const { handler } = setup(t);
  const s = await session(handler);
  const responses = await Promise.all(Array.from({ length: 50 }, () => post(handler, s)));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).count, 1);
  }
  const incognito = await session(handler);
  const data = await (await post(handler, incognito)).json();
  assert.equal(data.count, 1);
  assert.equal(data.joined, true);
});

test('different Google accounts sharing a network can each join', async (t) => {
  const { handler } = setup(t);
  await post(handler, await session(handler), 'google-user-one');
  const result = await post(handler, await session(handler), 'google-user-two');
  assert.equal((await result.json()).count, 2);
});

test('signed HttpOnly account cookie restores membership after reload and restart', async (t) => {
  const { handler, options } = setup(t);
  const response = await post(handler, await session(handler));
  const cookies = responseCookies(response);
  assert.match(response.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  const restarted = createHandler(options);
  const data = await (await get(restarted, cookies)).json();
  assert.equal(data.joined, true);
  assert.equal(data.count, 1);
});

test('forged session cookies and mismatched sign-in nonces are rejected', async (t) => {
  const { handler } = setup(t);
  const s = await session(handler);
  const result = await post(handler, { ...s, data: { nonce: 'another-nonce' } });
  assert.equal(result.status, 401);
  const forged = `${'a'.repeat(64)}.${'a'.repeat(43)}`;
  assert.equal((await (await get(handler, `larpable_account=${forged}`)).json()).joined, false);
});

test('client-supplied totals and cross-origin submissions cannot change the count', async (t) => {
  const { handler } = setup(t);
  const s = await session(handler);
  assert.equal((await post(handler, s, 'google-user-one', { count: 999999 })).status, 400);
  const response = await handler(new Request(`${origin}/api/community`, {
    method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json', Cookie: s.cookie },
    body: JSON.stringify({ credential: `google-user-one|${s.data.nonce}` }),
  }));
  assert.equal(response.status, 403);
  assert.equal((await (await get(handler)).json()).count, 0);
});

test('old anonymous totals are preserved and a previous browser click links without another increment', async (t) => {
  const { handler, file } = setup(t);
  const legacyId = randomUUID();
  writeFileSync(file, JSON.stringify({ members: [legacyId], rates: {} }));
  const s = await session(handler);
  s.cookie += `; larpable_visitor=${legacyId}.${sign(legacyId)}`;
  const response = await post(handler, s);
  assert.equal((await response.json()).count, 1);
  const other = await session(handler);
  other.cookie += `; larpable_visitor=${legacyId}.${sign(legacyId)}`;
  assert.equal((await (await post(handler, other, 'google-user-two')).json()).count, 2);
  assert.equal((await (await post(handler, await session(handler))).json()).count, 2);
});

test('new joins are rate limited without blocking retries from previously counted accounts', async (t) => {
  const { handler } = setup(t);
  for (let i = 0; i < 20; i++) {
    assert.equal((await post(handler, await session(handler), `google-user-${i}`)).status, 200);
  }
  const limited = await post(handler, await session(handler), 'google-user-new');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await post(handler, await session(handler), 'google-user-0')).status, 200);
});

test('storage failures and missing production configuration fail closed', async (t) => {
  const { options } = setup(t);
  const broken = createHandler({ ...options, store: { run() { throw new Error('Offline'); } } });
  assert.equal((await get(broken)).status, 503);
  const saved = [process.env.UPSTASH_REDIS_REST_URL, process.env.KV_REST_API_URL];
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.KV_REST_API_URL;
  try { assert.equal((await production.fetch(new Request(`${origin}/api/community`))).status, 503); }
  finally {
    for (const [i, name] of ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'].entries()) {
      if (saved[i] !== undefined) process.env[name] = saved[i];
    }
  }
});

test('sign-in requires configured Google client ID', async (t) => {
  const { options } = setup(t);
  const handler = createHandler({ ...options, googleClientId: '' });
  assert.equal((await post(handler, await session(handler))).status, 503);
});

test('invalid payloads and unsupported methods are rejected', async (t) => {
  const { handler } = setup(t);
  assert.equal((await handler(new Request(`${origin}/api/community`, { method: 'DELETE' }))).status, 405);
  for (const [body, status] of [['{', 400], ['null', 400], ['x'.repeat(12289), 413]]) {
    const response = await handler(new Request(`${origin}/api/community`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
    }));
    assert.equal(response.status, status);
  }
});

test('Redis sends all account linking and membership changes as one atomic operation', async (t) => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://redis.example');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(options.body), [
      'EVAL', counterScript, '4', 'larpable:members', 'larpable:rate:hashed-ip',
      'larpable:accounts', 'larpable:legacy-claims', 'account', 'join', 'legacy',
    ]);
    return Response.json({ result: [1, 42] });
  };
  const store = redisStore('https://redis.example', 'test-token');
  assert.deepEqual(await store.run('account', 'join', 'hashed-ip', 'legacy'), { joined: true, count: 42, limited: false });
  globalThis.fetch = async () => Response.json({ error: 'offline' });
  await assert.rejects(() => store.run('account', 'join', 'hashed-ip', 'legacy'));
  globalThis.fetch = async () => Response.json({ result: [1, 'wrong'] });
  await assert.rejects(() => store.run('account', 'join', 'hashed-ip', 'legacy'));
});

test('Google verifier passes the required audience to the official library and requires matching nonce and verified email', async (t) => {
  const saved = OAuth2Client.prototype.verifyIdToken;
  t.after(() => { OAuth2Client.prototype.verifyIdToken = saved; });
  let claims = { sub: 'google-subject', nonce: 'challenge', email_verified: true };
  OAuth2Client.prototype.verifyIdToken = async function(options) {
    assert.deepEqual(options, { idToken: 'credential', audience: clientId });
    return { getPayload: () => claims };
  };
  assert.equal(await verifyGoogleCredential('credential', clientId, 'challenge'), 'google-subject');
  claims = { ...claims, nonce: 'wrong' };
  await assert.rejects(() => verifyGoogleCredential('credential', clientId, 'challenge'));
  claims = { ...claims, nonce: 'challenge', email_verified: false };
  await assert.rejects(() => verifyGoogleCredential('credential', clientId, 'challenge'));
});
