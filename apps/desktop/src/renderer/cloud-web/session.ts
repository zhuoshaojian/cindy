import { z } from 'zod';
import type { CisSession } from './webApi';

const sessionSchema = z.object({
  membershipId: z.string().min(1).max(256),
  passportId: z.string().min(1).max(256),
  kind: z.string().min(1).max(32),
  orgSlug: z.string().max(256).nullable(),
});

export class CisSessionEndedError extends Error {
  constructor() {
    super('CIS_SIGNED_OUT');
  }
}

/** The CIS browser session; an ended one sends the owner back to the CIS sign-in page. */
export async function readCisSession(): Promise<CisSession> {
  const response = await fetch('/instance-login/api/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
  if (response.status === 401 || response.status === 403) throw new CisSessionEndedError();
  if (!response.ok) throw new Error('CIS_UNAVAILABLE');
  return sessionSchema.parse(await response.json());
}
