import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { redisStore } from '../lib/counter.mjs';

const cookieName = 'larpable_visitor';
const tokenPattern = /^[a-f0-9-]{36}\.[a-zA-Z0-9_-]{43}$/;

export function createHandler({ store, secret, secure = true }) {
  const sign = (value) => createHmac('sha256', secret).update(value).digest('base64url');
  function valid(token) {
    if (typeof token !== 'string' || !tokenPattern.test(token)) return false;
    const [id, signature] = token.split('.');
    return timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)));
  }
  return async (request) => {
    const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (!['GET', 'POST'].includes(request.method)) {
      headers.Allow = 'GET, POST';
      return json({ error: 'Method not allowed.' }, 405);
    }
    try {
      let body = {};
      if (request.method === 'POST') {
        if (request.headers.get('origin') !== new URL(request.url).origin ||
            !request.headers.get('content-type')?.startsWith('application/json')) {
          return json({ error: 'Invalid request.' }, 403);
        }
        const text = await request.text();
        if (text.length > 1024) return json({ error: 'Invalid request.' }, 413);
        try { body = JSON.parse(text); } catch { return json({ error: 'Invalid request.' }, 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return json({ error: 'Invalid request.' }, 400);
        }
      }
      const cookies = request.headers.get('cookie') || '';
      const cookie = cookies.split(';').map((item) => item.trim())
        .find((item) => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const supplied = request.method === 'POST' ? body.visitor : request.headers.get('x-visitor-token');
      let visitor = valid(cookie) ? cookie : valid(supplied) ? supplied : '';
      if (!visitor) {
        if (request.method === 'POST') return json({ error: 'Refresh the page and try again.' }, 400);
        const id = randomUUID();
        visitor = `${id}.${sign(id)}`;
      }
      const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const addressHash = sign(`address:${address}`);
      const result = await store.run(visitor.split('.')[0], request.method === 'POST' ? 'join' : 'read', addressHash);
      if (result.limited) {
        headers['Retry-After'] = '60';
        return json({ error: 'Please wait a minute before trying again.' }, 429);
      }
      headers['Set-Cookie'] = `${cookieName}=${visitor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000${secure ? '; Secure' : ''}`;
      return json({ count: result.count, joined: result.joined, visitor });
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
      return Response.json({ error: 'Unable to connect. Try again.' }, {
        status: 503, headers: { 'Cache-Control': 'no-store' },
      });
    }
    return createHandler({ store: redisStore(url, token), secret })(request);
  },
};
