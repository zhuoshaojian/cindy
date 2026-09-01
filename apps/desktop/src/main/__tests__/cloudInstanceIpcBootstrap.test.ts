import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const mainRoot = resolve(__dirname, '..');

/** Locks the real Electron startup path so cloud-instance handlers stay reachable. */
describe('cloud-instance IPC Electron bootstrap path', () => {
  it('registers the cloud handlers once in the ready-stage IPC sequence', () => {
    const bootstrap = readFileSync(resolve(mainRoot, 'bootstrap-electron.ts'), 'utf8');

    expect(bootstrap).toMatch(
      /import \{[^}]*\bregisterCloudInstanceIpc\b[^}]*\} from '\.\/cloud-instance\/ipc(?:\.js)?';/,
    );
    const endpointsInit = bootstrap.search(/if \(!\(await initClientEndpoints\(\)\)\) \{/);
    const cloudRegistration = bootstrap.search(/\bregisterCloudInstanceIpc\s*\(\s*\)\s*;/);
    const deviceLinkRegistration = bootstrap.search(/\bregisterDeviceLinkIpc\s*\(\s*\)\s*;/);

    expect(endpointsInit).toBeGreaterThanOrEqual(0);
    expect(cloudRegistration).toBeGreaterThan(endpointsInit);
    expect(deviceLinkRegistration).toBeGreaterThan(cloudRegistration);
    expect((bootstrap.match(/\bregisterCloudInstanceIpc\s*\(\s*\)\s*;/g) ?? []))
      .toHaveLength(1);
  });
});
