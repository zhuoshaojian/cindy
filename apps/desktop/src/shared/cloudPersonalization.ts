import { z } from 'zod';

/**
 * The owner's personal instructions on a managed cloud instance, for the same account's cloud
 * settings page. A private DeviceLink channel registered only by the cloud runtime; ordinary
 * desktops and older runtimes answer CHANNEL_NOT_ALLOWED, so the page keeps only its heading.
 *
 * The text never enters the CIS settings relay or its database. The Agent settings tool still
 * needs a confirmation on the instance before it may read the text.
 */
export const CLOUD_PERSONALIZATION_CHANNEL = 'cloud:personalization:v1';
/** Same limit as the Host store and the local editor. */
export const CLOUD_USER_PROMPT_MAX_LENGTH = 8000;

const ownerGeneration = z.number().int().nonnegative();
const revision = z.string().min(1).max(256);
export const cloudPersonalizationRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('read') }).strict(),
  z
    .object({
      op: z.literal('save'),
      ownerGeneration,
      revision,
      userPrompt: z.string().max(CLOUD_USER_PROMPT_MAX_LENGTH),
    })
    .strict(),
  z.object({ op: z.literal('reset'), ownerGeneration, revision }).strict(),
]);
export type CloudPersonalizationRequest = z.infer<typeof cloudPersonalizationRequestSchema>;

export const cloudPersonalizationStateSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      ownerGeneration,
      revision,
      userPrompt: z.string().max(CLOUD_USER_PROMPT_MAX_LENGTH),
      customized: z.boolean(),
    })
    .strict(),
  z.object({ status: z.enum(['unavailable', 'unreadable']), ownerGeneration }).strict(),
]);
export type CloudPersonalizationState = z.infer<typeof cloudPersonalizationStateSchema>;
