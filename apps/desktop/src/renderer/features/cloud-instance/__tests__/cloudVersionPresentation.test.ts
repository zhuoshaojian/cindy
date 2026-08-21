import { describe, expect, it } from 'vitest';

import { resolveCloudVersionPresentation } from '../cloudVersionPresentation';

describe('resolveCloudVersionPresentation', () => {
  it('shows the current digest-pinned release beside an available update', () => {
    expect(
      resolveCloudVersionPresentation({
        image: 'registry.example/public/cindy-cloud:0.1.7@sha256:abc',
        updateAvailable: true,
        updating: false,
      }),
    ).toEqual({ currentVersion: '0.1.7', upToDate: false });
  });

  it('keeps a development tag and marks an idle no-update instance current', () => {
    expect(
      resolveCloudVersionPresentation({
        image: 'registry.example/public/cindy-cloud:dev-e65195d-packaged',
        updateAvailable: false,
        updating: false,
      }),
    ).toEqual({ currentVersion: 'dev-e65195d-packaged', upToDate: true });
  });

  it('does not claim an update-in-progress instance is current', () => {
    expect(
      resolveCloudVersionPresentation({
        image: 'registry.example/public/cindy-cloud:0.1.7',
        updateAvailable: false,
        updating: true,
      }),
    ).toEqual({ currentVersion: '0.1.7', upToDate: false });
  });

  it('quietly omits an unparseable image reference', () => {
    expect(
      resolveCloudVersionPresentation({
        image: 'registry.example/public/cindy-cloud@sha256:abc',
        updateAvailable: false,
        updating: false,
      }),
    ).toEqual({ currentVersion: null, upToDate: false });
  });
});
