import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { AssistantError } from './errors.js';

export interface AssistantIdentity {
  readonly uid: string;
}
export interface AssistantAuthenticator {
  authenticate(authorization: string | undefined): Promise<AssistantIdentity>;
}

export class FirebaseGoogleAuthenticator implements AssistantAuthenticator {
  constructor(
    private readonly auth: Pick<Auth, 'verifyIdToken'>,
    private readonly projectId: string,
  ) {}

  async authenticate(
    authorization: string | undefined,
  ): Promise<AssistantIdentity> {
    if (!authorization)
      throw new AssistantError(
        'authentication-required',
        401,
        'Sign in with Google to use AI Chat.',
      );
    const match = /^Bearer ([A-Za-z0-9._-]{1,8192})$/.exec(authorization);
    if (!match?.[1])
      throw new AssistantError(
        'invalid-authentication',
        401,
        'Your sign-in could not be verified. Sign in again.',
      );
    let decoded: DecodedIdToken;
    try {
      // Revocation and disabled-user checks run on every request, including usage.
      decoded = await this.auth.verifyIdToken(match[1], true);
    } catch {
      throw new AssistantError(
        'invalid-authentication',
        401,
        'Your sign-in expired or was revoked. Sign in again.',
      );
    }
    if (
      decoded.aud !== this.projectId ||
      decoded.iss !== `https://securetoken.google.com/${this.projectId}` ||
      !decoded.uid ||
      decoded.uid.length > 128
    ) {
      throw new AssistantError(
        'invalid-authentication',
        401,
        'This sign-in belongs to an unapproved Firebase project.',
      );
    }
    if (
      decoded.firebase.sign_in_provider !== 'google.com' ||
      decoded.email_verified !== true
    ) {
      throw new AssistantError(
        'google-sign-in-required',
        403,
        'Use a verified Google account for AI Chat.',
      );
    }
    return { uid: decoded.uid };
  }
}
