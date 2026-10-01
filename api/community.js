import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { redisStore } from '../lib/counter.mjs';
import { verifyGoogleCredential } from '../lib/google-auth.mjs';

export function createHandler({ store, secret, secure = true, googleClientId = '', verifyCredential = verifyGoogleCredential }) {
  const sign = (value) => createHmac('sha256', secret).update(value).digest('base64url');
  function valid(token, purpose, pattern) {
    if (typeof token !== 'string' || !pattern.test(token)) return false;
    const [id, signature] = token.split('.');
    return timingSafeEqual(Buffer.from(signature), Buffer.from(sign(purpose + id)));
  }
  const uuidPattern = /^[a-f0-9-]{36}\.[a-zA-Z0-9_-]{43}$/;
  const accountPattern = /^[a-f0-9]{64}\.[a-zA-Z0-9_-]{43}$/;
  const accountId = (sub) => createHmac('sha256', secret).update(`google:${sub}`).digest('hex');
  const cookie = (name, value, age = 34560000) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  return async (request) => {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (!['GET', 'POST'].includes(request.method)) {
      headers.set('Allow', 'GET, POST');
      return json({ error: 'Method not allowed.' }, 405);
    }
    try {
      const cookies = Object.fromEntries((request.headers.get('cookie') || '').split(';').map((item) => {
        const position = item.indexOf('=');
        return position < 0 ? ['', ''] : [item.slice(0, position).trim(), item.slice(position + 1)];
      }));
      const session = cookies.larpable_account;
      let account = valid(session, 'account:', accountPattern) ? session.split('.')[0] : '';
      const challenge = cookies.larpable_challenge;
      let nonce = valid(challenge, 'nonce:', uuidPattern) ? challenge.split('.')[0] : '';
      const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const addressHash = sign(`address:${address}`);
      let legacyId = '';
      if (request.method === 'POST') {
        if (request.headers.get('origin') !== new URL(request.url).origin ||
            !request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Invalid request.' }, 403);
        const text = await request.text();
        if (text.length > 12288) return json({ error: 'Invalid request.' }, 413);
        let body;
        try { body = JSON.parse(text); } catch { return json({ error: 'Invalid request.' }, 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).some((key) => key !== 'credential') || typeof body.credential !== 'string') {
          return json({ error: 'Invalid request.' }, 400);
        }
        if (!googleClientId) return json({ error: 'Sign-in is unavailable. Please try later.' }, 503);
        if (!nonce) return json({ error: 'Sign-in expired. Please try again.' }, 401);
        let sub;
        try { sub = await verifyCredential(body.credential, googleClientId, nonce); }
        catch { return json({ error: 'Sign-in failed. Please try again.' }, 401); }
        if (typeof sub !== 'string' || !sub) return json({ error: 'Sign-in failed. Please try again.' }, 401);
        account = accountId(sub);
        const legacy = cookies.larpable_visitor;
        if (valid(legacy, '', uuidPattern)) legacyId = legacy.split('.')[0];
      }
      const result = await store.run(account, request.method === 'POST' ? 'join' : 'read', addressHash, legacyId);
      if (result.limited) {
        headers.set('Retry-After', '60');
        return json({ error: 'Please wait a minute before trying again.' }, 429);
      }
      if (request.method === 'POST') {
        headers.append('Set-Cookie', cookie('larpable_account', `${account}.${sign('account:' + account)}`));
        headers.append('Set-Cookie', cookie('larpable_challenge', '', 0));
      } else {
        nonce ||= randomUUID();
        headers.append('Set-Cookie', cookie('larpable_challenge', `${nonce}.${sign('nonce:' + nonce)}`, 600));
      }
      return json({ count: result.count, joined: result.joined, googleClientId, nonce: request.method === 'GET' ? nonce : '' });
    } catch {
      return json({ error: 'Unable to connect. Try again.' }, 503);
    }
  };
}

export default {
  async fetch(request) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    const secret = process.env.JOIN_COOKIE_SECRET;
    if (!url || !token || !secret || secret.length < 32) {
      return Response.json({ error: 'Unable to connect. Try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    return createHandler({ store: redisStore(url, token), secret, googleClientId: process.env.GOOGLE_CLIENT_ID || '' })(request);
  },
};
