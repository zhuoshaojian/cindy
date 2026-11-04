import { z } from 'zod';
import type { DesktopLoginState } from './authIpc';

const contact = z.string().trim().min(1).max(254);
export const cloudLoginActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reset') }).strict(),
  z.object({ type: z.literal('back') }).strict(),
  z.object({ type: z.literal('cancel-browser') }).strict(),
  z.object({ type: z.literal('discover'), email: contact }).strict(),
  z.object({ type: z.literal('discover-sso-org'), org: contact }).strict(),
  z
    .object({
      type: z.literal('request-code'),
      kind: z.enum(['phone', 'email']),
      identifier: contact,
      captchaToken: z.string().max(8192).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('verify-code'),
      kind: z.enum(['phone', 'email']),
      identifier: contact,
      code: z.string().regex(/^\d{6}$/u),
    })
    .strict(),
  z
    .object({
      type: z.literal('start-browser'),
      kind: z.enum(['social', 'sso']),
      providerOrConnectionId: z.string().min(1).max(256),
      label: z.string().max(256),
    })
    .strict(),
  z.object({ type: z.literal('request-sso-verification-code') }).strict(),
  z
    .object({ type: z.literal('verify-sso-verification'), code: z.string().min(1).max(16) })
    .strict(),
  z.object({ type: z.literal('request-binding-code'), contact }).strict(),
  z
    .object({ type: z.literal('verify-binding'), contact, code: z.string().regex(/^\d{6}$/u) })
    .strict(),
]);
export type CloudLoginAction = z.infer<typeof cloudLoginActionSchema>;
export const cloudLoginHandleSchema = z.object({ handle: z.string().uuid() }).strict();
export const cloudLoginDispatchSchema = cloudLoginHandleSchema
  .extend({ action: cloudLoginActionSchema })
  .strict();
/** UI only. CIS capabilities, PKCE proofs, tickets and credentials stay in Main/CIS. */
export interface CloudInstanceLoginView {
  handle: string;
  state: DesktopLoginState;
  complete: boolean;
  captchaChallengeUrl?: string;
  errorCode?: string;
  retryAt?: number;
}
