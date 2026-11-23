import { parseAuthorizationCallbackUrl } from '@cindy/device-link';
import type { ManagementPrompt } from '../../../shared/settingsManagement';
import { CloudClientError } from '../../../main/cloud-settings-client/transport';

/**
 * Browser build of the cloud management callback. A page cannot listen on loopback, so
 * the owner pastes the redirected address, as on the existing CIS settings page; it is
 * checked the same way as the native manual entry. The cloud CLI on the instance still
 * owns PKCE, token exchange and credential storage.
 */
export function createCloudAuthorizationCallback(input: {
  prompt: ManagementPrompt;
  assertCurrent(): void;
  submit(value: string): Promise<void>;
  now(): number;
}) {
  let closed = false;
  let claimed = false;
  let validateManual: ((value: string) => void) | undefined;
  const deadline = Math.min(input.prompt.expiresAt, input.now() + 5 * 60_000);
  const ready = (async () => {
    input.assertCurrent();
    const authorize = new URL(input.prompt.url);
    const redirects = [
      ...authorize.searchParams.getAll('redirect_uri'),
      ...authorize.searchParams.getAll('callback_url'),
    ];
    const states = authorize.searchParams.getAll('state');
    if (
      input.prompt.kind !== 'callback' ||
      authorize.protocol !== 'https:' ||
      authorize.username ||
      authorize.password ||
      authorize.hash ||
      redirects.length !== 1 ||
      states.length !== 1 ||
      !/^[A-Za-z0-9._~-]{16,512}$/.test(states[0]!)
    )
      throw new CloudClientError('CLOUD_SETTINGS_NOT_READY');
    const endpoint = new URL(parseAuthorizationCallbackUrl(redirects[0]));
    validateManual = (value) => {
      const url = new URL(value.trim());
      if (
        url.origin !== endpoint.origin ||
        url.pathname !== endpoint.pathname ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.getAll('state').length !== 1 ||
        url.searchParams.get('state') !== states[0] ||
        url.searchParams.getAll('code').length + url.searchParams.getAll('error').length !== 1
      )
        throw new CloudClientError('CLOUD_SETTINGS_NOT_READY');
    };
  })().catch(() => {
    closed = true;
    throw new CloudClientError('CLOUD_SETTINGS_NOT_READY');
  });
  return {
    url: input.prompt.url,
    ready,
    close: () => {
      closed = true;
    },
    finish: () => {
      closed = true;
    },
    claimManual(value: string) {
      input.assertCurrent();
      if (!validateManual || closed || input.now() >= deadline)
        throw new CloudClientError('CLOUD_SETTINGS_NOT_READY');
      try {
        validateManual(value);
      } catch {
        throw new CloudClientError('CLOUD_SETTINGS_NOT_READY');
      }
      if (claimed) throw new CloudClientError('CLOUD_SETTINGS_BUSY');
      claimed = true;
      closed = true;
    },
  };
}
