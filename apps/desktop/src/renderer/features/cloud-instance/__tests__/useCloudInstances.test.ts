import { describe, expect, it } from 'vitest';

import { isCloudInstancesUnsupportedError } from '../useCloudInstances';

describe('useCloudInstances capability visibility', () => {
  it('treats endpoint absence and server-side disablement as unsupported', () => {
    const endpointError = Object.assign(new Error('cloud instance control is unavailable'), {
      code: 'UNSUPPORTED_CAPABILITY' as const,
    });
    const disabledError = Object.assign(new Error('cloud instance control is disabled for this account'), {
      code: 'CLOUD_INSTANCE_DISABLED' as const,
    });
    expect(isCloudInstancesUnsupportedError(endpointError)).toBe(true);
    expect(isCloudInstancesUnsupportedError(disabledError)).toBe(true);
  });

  it('keeps transient service failures as errors so the UI can retry', () => {
    const unavailableError = Object.assign(new Error('cloud instance service request failed'), {
      code: 'CLOUD_INSTANCE_UNAVAILABLE' as const,
    });
    expect(isCloudInstancesUnsupportedError(unavailableError)).toBe(false);
  });
});
