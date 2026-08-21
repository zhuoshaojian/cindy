import { describe, expect, it } from 'vitest';

import { CLOUD_DEVICE_NAME_SENTINEL } from '../deviceList.js';
import { describeCloudInstanceName } from '../cloudInstance.js';

describe('cloud instance name descriptor', () => {
  it('preserves a user custom label verbatim', () => {
    expect(
      describeCloudInstanceName({
        nameSequence: 2,
        customLabel: '  Build Pod  ',
      }),
    ).toEqual({ kind: 'custom', label: '  Build Pod  ' });
  });

  it('describes an ordinal default without choosing a locale', () => {
    expect(describeCloudInstanceName({ nameSequence: 3, customLabel: null })).toEqual({
      kind: 'default',
      sequence: 3,
    });
  });

  it.each([
    null,
    undefined,
    { nameSequence: 0, customLabel: null },
    { nameSequence: 1.5, customLabel: null },
    { nameSequence: 1, customLabel: '' },
    { nameSequence: 1, customLabel: undefined },
  ])(
    'falls back to the existing generic sentinel for unavailable or malformed metadata',
    (metadata) => {
      expect(
        describeCloudInstanceName(
          metadata as unknown as Parameters<typeof describeCloudInstanceName>[0],
        ),
      ).toEqual({
        kind: 'fallback',
        name: CLOUD_DEVICE_NAME_SENTINEL,
      });
    },
  );
});
