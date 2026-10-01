# Enable Google sign-in

The page and counter now require a verified Google account before adding a click. The same account counts once across devices, browsers and incognito sessions. Different accounts on the same Wi-Fi can each join. Someone with multiple Google accounts can still count once per account; this is not proof of one physical person.

## Configure Google

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project for larpable.
2. Open **Google Auth Platform** and complete **Branding** with app name `larpable`, your support email and your developer contact email. Choose **External** audience for the public community.
3. Open **Clients → Create client**. Choose **Web application** and name it `larpable web`.
4. Under **Authorized JavaScript origins**, add `https://larpable.vercel.app`. For local testing also add `http://localhost` and `http://localhost:4310`.
5. Create the client and copy the **Client ID**, ending in `.apps.googleusercontent.com`. This implementation does not require a client secret or redirect URI.
6. Under **Audience**, add your Google account as a test user while testing. For public use, change the publishing status to **In production**. Follow any additional verification requirements Google displays.

See [Google's setup instructions](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Configure Vercel

1. Open **larpable → Settings → Environment Variables**.
2. Add `GOOGLE_CLIENT_ID` with the copied Client ID, for **Production**.
3. Keep the existing Redis variables and `JOIN_COOKIE_SECRET` unchanged. The stable secret is needed to preserve account identities.
4. Push the code and redeploy the latest production commit after adding the variable.

The public Client ID is intentionally sent to the browser. Redis credentials and the cookie signing secret remain server-only.

## Local preview

Create an ignored `.env.local` file containing:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Run `npm run dev` and open **http://localhost:4310**. Local storage remains separate from the production Redis counter. Without a Client ID, the page still displays the local total, but the sign-in dialog reports that sign-in is unavailable. There is no fake local authentication mode.

## Verification

1. Click Join and use the Google button in the dialog. The count should increase once.
2. Open an incognito window and sign in to the same Google account. The count must remain unchanged.
3. A different Google account on the same Wi-Fi should add one count.

Server-side verification checks Google's signature, audience, issuer and expiration through its official library, plus the browser-specific sign-in nonce and verified email. The app only stores a keyed hash of the Google account ID, not names or email addresses. The membership update and account link are atomic. Existing anonymous totals remain; an existing valid browser cookie can link its prior click to a Google account without another increment. Old anonymous clicks whose cookies were lost cannot be matched to an account retroactively.

Editing the visible number in browser developer tools changes only that local screen. It cannot edit Redis. No website can prevent its owner from modifying a locally displayed page. The join API rejects anonymous identities, forged sign-in credentials and client-supplied counts.

[Google's server verification documentation](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
