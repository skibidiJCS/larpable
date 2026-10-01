import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../api/community.js';
import production from '../api/community.js';
import { localStore } from '../scripts/local-store.mjs';
import { redisStore, counterScript } from '../lib/counter.mjs';

const origin = 'https://larpable.vercel.app';
function setup(t) {
  const folder = mkdtempSync(join(tmpdir(), 'larpable-test-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'counter.json');
  const secret = 'test-secret-with-at-least-32-characters';
  const handler = createHandler({ store: localStore(file), secret });
  return { handler, file, secret };
}
const get = (handler, headers = {}) => handler(new Request(`${origin}/api/community`, { headers }));
const post = (handler, visitor, headers = {}) => handler(new Request(`${origin}/api/community`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ visitor }),
}));

test('reading creates a signed identity without increasing the count', async (t) => {
  const { handler } = setup(t);
  const response = await get(handler);
  const data = await response.json();
  assert.equal(data.count, 0);
  assert.equal(data.joined, false);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('50 simultaneous submissions count the same visitor only once, including after reload/restart', async (t) => {
  const { handler, file, secret } = setup(t);
  const { visitor } = await (await get(handler)).json();
  const responses = await Promise.all(Array.from({ length: 50 }, () => post(handler, visitor)));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { visitor, joined: true, count: 1 });
  }
  const restarted = createHandler({ store: localStore(file), secret });
  const data = await (await get(restarted, { Cookie: `larpable_visitor=${visitor}` })).json();
  assert.equal(data.joined, true);
  assert.equal(data.count, 1);
});

test('different visitors sharing a network are counted individually', async (t) => {
  const { handler } = setup(t);
  const first = await (await get(handler)).json();
  const second = await (await get(handler)).json();
  await post(handler, first.visitor);
  const data = await (await post(handler, second.visitor)).json();
  assert.equal(data.count, 2);
});

test('cookie and browser storage each independently restore joined state', async (t) => {
  const { handler } = setup(t);
  const { visitor } = await (await get(handler)).json();
  await post(handler, visitor);
  for (const headers of [
    { Cookie: `larpable_visitor=${visitor}` },
    { 'X-Visitor-Token': visitor },
  ]) {
    assert.equal((await (await get(handler, headers)).json()).joined, true);
  }
});

test('a valid cookie takes precedence over another token', async (t) => {
  const { handler } = setup(t);
  const first = await (await get(handler)).json();
  const second = await (await get(handler)).json();
  await post(handler, first.visitor);
  const data = await (await post(handler, second.visitor, { Cookie: `larpable_visitor=${first.visitor}` })).json();
  assert.equal(data.count, 1);
  assert.equal(data.visitor, first.visitor);
});

test('forged identities and cross-origin submissions cannot change the count', async (t) => {
  const { handler } = setup(t);
  const { visitor } = await (await get(handler)).json();
  assert.equal((await post(handler, visitor.slice(0, -3) + 'aaa')).status, 400);
  assert.equal((await post(handler, visitor, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await (await get(handler)).json()).count, 0);
});

test('new joins are rate limited while previously counted visitors remain accepted', async (t) => {
  const { handler } = setup(t);
  let first;
  for (let i = 0; i < 20; i++) {
    const { visitor } = await (await get(handler)).json();
    first ||= visitor;
    assert.equal((await post(handler, visitor)).status, 200);
  }
  const { visitor } = await (await get(handler)).json();
  const limited = await post(handler, visitor);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await post(handler, first)).status, 200);
  assert.equal((await (await get(handler)).json()).count, 20);
});

test('unsupported methods and malformed payloads are rejected', async (t) => {
  const { handler } = setup(t);
  assert.equal((await handler(new Request(`${origin}/api/community`, { method: 'DELETE' }))).status, 405);
  for (const [body, status] of [['{', 400], ['null', 400], ['x'.repeat(1025), 413]]) {
    const response = await handler(new Request(`${origin}/api/community`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
    }));
    assert.equal(response.status, status);
  }
});

test('storage failure never reports a successful join', async () => {
  const handler = createHandler({ store: { run() { throw new Error('Offline'); } }, secret: 'secret' });
  assert.equal((await get(handler)).status, 503);
});

test('production fails closed without configured storage', async () => {
  const saved = process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  try { assert.equal((await production.fetch(new Request(`${origin}/api/community`))).status, 503); }
  finally { if (saved !== undefined) process.env.UPSTASH_REDIS_REST_URL = saved; }
});

test('Redis REST submits one atomic operation and validates the result', async (t) => {
  const saved = globalThis.fetch;
  t.after(() => { globalThis.fetch = saved; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://redis.example');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(options.body), [
      'EVAL', counterScript, '2', 'larpable:members', 'larpable:rate:hashed-ip', 'visitor', 'join',
    ]);
    return Response.json({ result: [1, 42] });
  };
  const store = redisStore('https://redis.example', 'test-token');
  assert.deepEqual(await store.run('visitor', 'join', 'hashed-ip'), { joined: true, count: 42, limited: false });
  globalThis.fetch = async () => Response.json({ error: 'offline' });
  await assert.rejects(() => store.run('visitor', 'join', 'hashed-ip'));
  globalThis.fetch = async () => Response.json({ result: [1, 'wrong'] });
  await assert.rejects(() => store.run('visitor', 'join', 'hashed-ip'));
});
