import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createHandler } from '../api/community.js';
import { localStore } from './local-store.mjs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
mkdirSync('.preview', { recursive: true });
if (!existsSync('.preview/secret')) writeFileSync('.preview/secret', randomBytes(32).toString('hex'));
const handler = createHandler({
  store: localStore('.preview/counter.json'),
  secret: readFileSync('.preview/secret', 'utf8'),
  secure: false,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
});
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/script.js', ['script.js', 'text/javascript']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/favicon.ico', ['favicon.ico', 'image/x-icon']],
  ['/apple-touch-icon.png', ['apple-touch-icon.png', 'image/png']],
]);
const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    if (!['127.0.0.1:4310', 'localhost:4310'].includes(host)) { res.writeHead(400); res.end(); return; }
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/api/community') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 12288) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const request = new Request(url, {
        method: req.method, headers: req.headers,
        ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await handler(request);
      const responseHeaders = Object.fromEntries(response.headers);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) responseHeaders['set-cookie'] = cookies;
      res.writeHead(response.status, responseHeaders);
      res.end(await response.text());
      return;
    }
    const asset = assets.get(url.pathname);
    if (!asset || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(asset[0]));
  } catch {
    res.writeHead(500); res.end('Unable to load.');
  }
});
server.listen(4310, '127.0.0.1', () => console.log('Preview: http://localhost:4310 (local counter; real Google sign-in requires GOOGLE_CLIENT_ID)'));
