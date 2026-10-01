# larpable

A minimal page with a central join button and a shared count. No client dependencies, accounts, redirects, or tracking tools.

## Preview

Requires Node.js 22 or newer.

```sh
npm run dev
```

Open http://127.0.0.1:4310. The preview uses a separate counter saved in ignored `.preview/` files. Production always uses Redis. Local clicks do not affect the live total.

```sh
npm test
npm run build
```

## GitHub

Create an empty GitHub repository named `larpable`, then replace `YOUR_USERNAME`:

```sh
git add index.html styles.css script.js api lib scripts tests package.json package-lock.json vercel.json .gitignore .env.example README.md
git commit -m "Build minimal larpable community counter"
git remote add origin https://github.com/YOUR_USERNAME/larpable.git
git push -u origin main
```

## Vercel

1. Import that repository at https://vercel.com/new. Name the project `larpable` and choose framework **Other**. The build and public output are set in `vercel.json`.
2. Connect an **Upstash Redis** database from Vercel's Storage/Marketplace. It needs to populate `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the project's environment. If the integration uses different variable names, copy the values under those exact names.
3. Add `JOIN_COOKIE_SECRET` as a Vercel environment variable, using a stable random secret of at least 32 characters. Generate it locally:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. Deploy or redeploy after the environment variables are connected. Set them for Production and Preview; use a separate Redis database for Preview if preview clicks should not affect production.
5. Check that `larpable.vercel.app` is assigned to your project. That exact hostname depends on availability; it cannot be guaranteed by the source code.

GitHub-connected deployments update after subsequent pushes to `main`.

Official setup: [Vercel Git deployments](https://vercel.com/docs/git), [Upstash on Vercel](https://vercel.com/marketplace/upstash).

## One-click protection

- A signed visitor identity is saved in an HttpOnly cookie and backed up in browser local storage. Either can restore the existing joined state.
- Redis checks membership and adds the visitor atomically. Repeated or simultaneous requests for the same identity count once, including across server restarts/deployments.
- The server rejects forged identities and cross-origin submissions. New joins are capped at 20 per network address per minute to slow bulk submissions; address keys use a keyed hash, expire after a minute, and raw addresses are not stored in Redis.
- Keep `JOIN_COOKIE_SECRET` stable: rotating it invalidates existing visitor identities.
- This enforces one click per browser identity. Another browser/device, private browsing, or clearing both browser stores can bypass it. Enforcing one click per actual person requires identity verification or sign-in.
- On errors the page offers a retry and does not invent a count. Without configured production storage, the endpoint returns 503.

Use a dedicated Redis database with eviction disabled so membership records are preserved.
