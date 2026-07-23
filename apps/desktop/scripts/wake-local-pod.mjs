#!/usr/bin/env node
/**
 * wake-local-pod.mjs — human-only local PoC.
 *
 * Logs in against the local auth-server, provisions one account session for a
 * Pod device, and prints the environment/command for a later headless launch.
 * It never writes tokens or verification codes to the repository.
 *
 * Usage:
 *   node apps/desktop/scripts/wake-local-pod.mjs \
 *     --phone <phone> --pod-device-id pod-cloud-1
 *   node apps/desktop/scripts/wake-local-pod.mjs \
 *     --phone <phone> --pod-device-id pod-cloud-1 \
 *     --phone-code 123456
 *   node apps/desktop/scripts/wake-local-pod.mjs \
 *     --access-token <existing-resource-access-token> \
 *     --pod-device-id pod-cloud-1
 *
 * With no --phone-code, read the code printed by the local auth-server
 * (`/tmp/auth-server.out`, event `sms.console`) and enter it at the prompt.
 */

import readline from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_AUTH_BASE_URL = 'http://localhost:3344';
const DEFAULT_USER_DEVICE_ID = 'poc-user-primary';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'help') {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    'Local PoC only:',
    '  node apps/desktop/scripts/wake-local-pod.mjs --phone <E.164> --pod-device-id <id>',
    '  node apps/desktop/scripts/wake-local-pod.mjs --access-token <token> --pod-device-id <id>',
    '',
    'Options:',
    '  --phone <phone>             Phone used for local SMS login',
    '  --phone-code <code>         Code from /tmp/auth-server.out (sms.console)',
    '  --access-token <token>      Skip login and use an existing resource token',
    '  --user-device-id <id>       Login device (default: poc-user-primary)',
    '  --pod-device-id <id>        New Pod device identity (required)',
    '  --auth-base <url>           Local auth base (default: http://localhost:3344)',
  ].join('\n');
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = body?.error;
    const code = error?.code ?? `HTTP_${response.status}`;
    const message = error?.message ?? 'local auth request failed';
    throw new Error(`${code}: ${message}`);
  }
  return body;
}

async function promptForCode(prompt) {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

function resolveAuthBase(explicitBase) {
  if (explicitBase || process.env.XDT_LOCAL_AUTH_BASE_URL) {
    return (explicitBase || process.env.XDT_LOCAL_AUTH_BASE_URL).replace(/\/+$/, '');
  }
  const manifestPath =
    process.env.XDT_ENDPOINT_MANIFEST_FILE ||
    path.resolve(SCRIPT_DIR, '../../../config/endpoint.local.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.authApiBaseUrl === 'string' && manifest.authApiBaseUrl.trim()) {
      return manifest.authApiBaseUrl.trim().replace(/\/+$/, '');
    }
  } catch {
    // The local dev wrapper may not have generated its manifest yet.
  }
  return DEFAULT_AUTH_BASE_URL;
}

async function loginByPhone({ baseUrl, phone, code, deviceId }) {
  let verificationCode = code;
  if (!verificationCode) {
    await requestJson(baseUrl, '/api/auth/phone/request-code', {
      method: 'POST',
      body: { phone, locale: 'en' },
    });
    console.error(
      '[local PoC] SMS request sent. Read the latest sms.console code in /tmp/auth-server.out.',
    );
    verificationCode = await promptForCode('SMS verification code: ');
  }
  if (!/^\d{6}$/.test(verificationCode)) {
    throw new Error('phone verification code must be 6 digits');
  }
  const outcome = await requestJson(baseUrl, '/api/auth/phone/verify-code', {
    method: 'POST',
    body: {
      phone,
      code: verificationCode,
      deviceId,
      clientType: 'desktop',
      locale: 'en',
    },
  });
  if (outcome.status === 'ok' && typeof outcome.accessToken === 'string') {
    return outcome.accessToken;
  }
  if (outcome.status !== 'select_account' || typeof outcome.accountToken !== 'string') {
    throw new Error(`phone login returned unexpected status: ${outcome.status ?? '<missing>'}`);
  }

  // A Passport with multiple memberships returns an account token plus a
  // selection ticket. Choose its personal membership for the Pod session.
  const memberships = await requestJson(baseUrl, '/api/auth/account', {
    token: outcome.accountToken,
  });
  const personal = memberships.memberships?.find((membership) => membership.kind === 'personal');
  if (!personal?.id) throw new Error('phone login account has no personal membership');
  const exchanged = await requestJson(baseUrl, '/api/auth/account/exchange', {
    method: 'POST',
    token: outcome.accountToken,
    body: { membershipId: personal.id },
  });
  if (typeof exchanged.accessToken !== 'string') {
    throw new Error('account exchange returned no resource access token');
  }
  return exchanged.accessToken;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const podDeviceId = args['pod-device-id'];
  if (!podDeviceId) throw new Error('--pod-device-id is required');
  if (podDeviceId.length > 128) throw new Error('--pod-device-id must be at most 128 characters');

  const baseUrl = resolveAuthBase(args['auth-base']);
  const userDeviceId = args['user-device-id'] || DEFAULT_USER_DEVICE_ID;
  const accessToken =
    args['access-token'] ||
    process.env.XDT_LOCAL_USER_ACCESS_TOKEN ||
    (args.phone
      ? await loginByPhone({
          baseUrl,
          phone: args.phone,
          code: args['phone-code'],
          deviceId: userDeviceId,
        })
      : null);
  if (!accessToken) {
    throw new Error('provide --access-token or --phone');
  }

  const provisioned = await requestJson(baseUrl, '/api/auth/account/provision-device', {
    method: 'POST',
    token: accessToken,
    body: { deviceId: podDeviceId, label: args.label || '云端实例' },
  });
  if (typeof provisioned.accountRefreshToken !== 'string') {
    throw new Error('provision-device returned no accountRefreshToken');
  }

  const command =
    `XDT_POD_ACCOUNT_REFRESH_TOKEN='${provisioned.accountRefreshToken}' ` +
    `XDT_POD_DEVICE_ID='${podDeviceId}' ` +
    'pnpm dev:desktop:headless:local --isolated=pod-cloud';
  console.log(JSON.stringify({
    localAuthBaseUrl: baseUrl,
    podDeviceId,
    accountRefreshToken: provisioned.accountRefreshToken,
  }, null, 2));
  console.log('\nRun in a separate human terminal:\n' + command);
}

main().catch((error) => {
  console.error(`[local PoC] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
