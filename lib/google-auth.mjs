import { OAuth2Client } from 'google-auth-library';
const client = new OAuth2Client();

export async function verifyGoogleCredential(credential, audience, nonce) {
  const ticket = await client.verifyIdToken({ idToken: credential, audience });
  const claims = ticket.getPayload();
  if (!claims?.sub || claims.nonce !== nonce || claims.email_verified !== true) {
    throw new Error('Invalid identity');
  }
  return claims.sub;
}
