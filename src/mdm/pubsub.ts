import { OAuth2Client } from "google-auth-library";

/**
 * Verifies the OIDC JWT that Google Cloud Pub/Sub attaches to authenticated push requests:
 * signature (Google certs), audience, and the push service-account email.
 * Fails closed if not configured.
 */
export function makePubSubVerifier(audience?: string, serviceAccount?: string) {
  const client = new OAuth2Client();
  return async (authorization: string | undefined): Promise<boolean> => {
    if (!audience || !serviceAccount || !authorization?.startsWith("Bearer ")) return false;
    try {
      const ticket = await client.verifyIdToken({ idToken: authorization.slice(7), audience });
      const p = ticket.getPayload();
      return !!p && p.email === serviceAccount && p.email_verified === true;
    } catch {
      return false;
    }
  };
}
