import { describe, expect, it } from 'vitest';
import { modelAccessReadiness } from '../cloud-runtime/model-access.js';
import type { ModelAccessStatus } from '../../shared/modelAccess.js';

function status(state: ModelAccessStatus['state']): ModelAccessStatus {
  return { state, source: null, endpoint: null };
}

describe('cloud runtime model-access observation', () => {
  it.each([
    ['ok', 'ready'],
    ['failed', 'not-ready'],
    ['unsupported', 'not-ready'],
    ['idle', 'unknown'],
    ['syncing', 'unknown'],
    ['disabled', 'unknown'],
  ] as const)('maps credentialsSync %s to %s', (state, expected) => {
    expect(modelAccessReadiness(status(state))).toBe(expected);
  });

  it.each(['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'GATEWAY_ERROR'])(
    'maps transient failed code %s to unknown',
    (errorCode) => {
      expect(modelAccessReadiness({ ...status('failed'), errorCode })).toBe('unknown');
    },
  );

  it.each(['AD_ACCOUNT_MISSING', 'SAFE_STORAGE_UNAVAILABLE', 'INVALID_RESPONSE'])(
    'maps actionable failed code %s to not-ready',
    (errorCode) => {
      expect(modelAccessReadiness({ ...status('failed'), errorCode })).toBe('not-ready');
    },
  );
});
