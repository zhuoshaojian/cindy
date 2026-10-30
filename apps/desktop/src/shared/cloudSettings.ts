import { z } from 'zod';
import { settingsEditableValueSchema } from './settingsEditableCatalog.js';
import { SETTINGS_WEB_MAX_CHOICES, settingsWebReadResultSchema } from './settingsWeb.js';

/** Native cloud settings reuse the local menu and presentation components.
 * Project only domains with compatible remote state and native controllers;
 * never fill remote fields from this computer's settings or provider catalog.
 * Authorization and lifecycle operations use their existing dedicated commands. */
// UI projection only. Remote commands use settingsWeb/settingsManagement.
export const CLOUD_SETTINGS_GROUPS = {
  general: [
    'desktopGeneral',
    'desktopChat',
    'desktopNotifications',
    'collaboration',
    'agentResource',
    'gitSafety',
    'lsp',
  ],
  appearance: ['desktopGeneral', 'appearance', 'desktopChat'],
  personalization: [
    'personalization',
    'memory',
    'contacts',
    'contactsSync',
    'chatEmbedding',
    'silentEncryptedRetry',
    'terminal',
    'desktopChat',
  ],
  providers: [],
  'im-bot': [
    'imFeishu',
    'imDiscord',
    'imWechat',
    'imTelegram',
    'imDingtalk',
    'imWecom',
    'telegramBehavior',
    'telegramGroups',
  ],
  ghosts: [],
  'builtin-tools': ['builtinTools', 'browserTools'],
  'computer-use': ['browserTools', 'browserBackend', 'computerTools', 'androidTools'],
  storage: ['databaseWarning'],
  about: ['privacy', 'diagnostics'],
} as const;
export type CloudSettingsTab = keyof typeof CLOUD_SETTINGS_GROUPS;
export const CLOUD_SETTINGS_DOMAINS = [...new Set(Object.values(CLOUD_SETTINGS_GROUPS).flat())];
export type CloudSettingsDomain = (typeof CLOUD_SETTINGS_DOMAINS)[number];
export const cloudSettingsDomainSchema = z.enum(
  CLOUD_SETTINGS_DOMAINS as [CloudSettingsDomain, ...CloudSettingsDomain[]],
);
/** Local presentation flags, projected from existing capabilities; never a Host protocol. */
export interface CloudSettingsCapabilities {
  version: 1;
  deviceId: string;
  runtimeId: string;
  ownerGeneration: number;
  providerAuthorization?: 1;
  botAuthorization?: 1;
  pluginAuthorization?: 1;
  mcpAuthorization?: 1;
  cpuCount?: number;
  domains: CloudSettingsDomain[];
}
const values = z.record(z.string(), settingsEditableValueSchema);
// Presentation-only diagnostic: never forwarded as a Host setting or credential.
export const cloudSettingsReadErrorCodeSchema = z.enum([
  'SETTINGS_REQUEST_FAILED',
  'SETTINGS_RESPONSE_TOO_LARGE',
  'MODEL_CATALOG_TOO_LARGE',
  'UNREADABLE',
]);
export const cloudSettingsStateSchema = z
  .object({
    domain: cloudSettingsDomainSchema,
    status: z.enum(['ready', 'unavailable', 'unreadable']),
    readErrorCode: cloudSettingsReadErrorCodeSchema.optional(),
    revision: z.string().min(1).max(128).nullable(),
    operationId: z.string().uuid().optional(),
    value: values.optional(),
    defaults: values.optional(),
    customizedKeys: z.array(z.string()).max(16).optional(),
    isCustomized: z.boolean().optional(),
    choices: z
      .record(
        z.string(),
        z
          .array(
            z
              .object({
                value: settingsEditableValueSchema,
                label: z.string().max(512),
                efforts: z
                  .array(z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']))
                  .max(7)
                  .optional(),
                supportsFast: z.boolean().optional(),
              })
              .strict(),
          )
          .max(SETTINGS_WEB_MAX_CHOICES),
      )
      .optional(),
  })
  .strict()
  .superRefine(({ readErrorCode, ...state }, ctx) => {
    if (readErrorCode && state.status !== 'unreadable')
      ctx.addIssue({ code: 'custom', message: 'read error requires unreadable state' });
    // Reuse the existing business validator for every real cloud state. Only the
    // in-memory preview has a prompt body; it is never accepted by Main.
    if (state.domain !== 'personalization') {
      if (!settingsWebReadResultSchema.safeParse({ ok: true, settings: state }).success)
        ctx.addIssue({ code: 'custom', message: 'invalid cloud settings state' });
      return;
    }
    if (state.status !== 'ready') {
      if (state.revision !== null || state.value || state.defaults || state.operationId)
        ctx.addIssue({ code: 'custom', message: 'invalid unavailable state' });
      return;
    }
    const schema = z.object({ userPrompt: z.string().max(8000) }).strict();
    if (
      !state.revision ||
      !state.operationId ||
      !schema.safeParse(state.value).success ||
      !schema.safeParse(state.defaults).success ||
      !state.customizedKeys ||
      state.customizedKeys.some((key) => !Object.hasOwn(schema.shape, key)) ||
      new Set(state.customizedKeys).size !== state.customizedKeys.length ||
      state.isCustomized !== state.customizedKeys.length > 0
    )
      ctx.addIssue({ code: 'custom', message: 'invalid cloud settings state' });
  });
export type CloudSettingsState = z.infer<typeof cloudSettingsStateSchema>;
