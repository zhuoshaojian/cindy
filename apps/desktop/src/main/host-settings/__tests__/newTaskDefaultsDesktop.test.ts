import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => host.root } }));
// An ordinary desktop: no managed cloud instance configuration.
vi.mock('../../instance-runtime/config.js', () => ({ getInstanceConfig: () => null }));
vi.mock('../../appSessionState.js', () => ({
  dataOwnerStorageKey: (id: string) => `test-${id}`,
  peekCommittedAppSession: () => ({ mode: 'local', dataOwnerId: 'owner-a', generation: 1 }),
  isAppSessionBoundaryPending: () => false,
}));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ info() {}, warn() {} }) }));
vi.mock('../../maker-host/createDesktopProviderService.js', () => ({ getDesktopProviderService: () => ({ listProviders: async () => [] }) }));
vi.mock('../../maker-host/model-visibility-mirror.js', () => ({ waitForModelVisibilityMirror: async () => {}, getModelVisibilityOverride: () => undefined }));
import {
  applyHostModelEffort, applyHostRemoteDraftPreference, commitNewTaskDefaults, hostOwnsNewTaskDefaults,
  inspectNewTaskDefaults, inspectNewTaskDefaultsForSnapshot, readNewTaskPreferenceHistory, saveNewTaskPreferenceHistory,
} from '../new-task-defaults';

beforeEach(() => { host.root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-task-desktop-')); });
afterEach(() => fs.rmSync(host.root, { recursive: true, force: true }));

describe('new-task defaults on an ordinary desktop', () => {
  it('stay with the renderer draft: reads report unavailable and no Host file is created', () => {
    expect(hostOwnsNewTaskDefaults()).toBe(false);
    expect(inspectNewTaskDefaults()).toEqual({ status: 'unavailable', revision: null });
    expect(inspectNewTaskDefaultsForSnapshot()).toEqual({ status: 'unavailable', revision: null });
    expect(readNewTaskPreferenceHistory()).toBeNull();
    expect(fs.readdirSync(host.root)).toEqual([]);
  });

  it('reject every Host write path without touching disk', async () => {
    const unsupported = { code: 'UNSUPPORTED_CAPABILITY' };
    await expect(commitNewTaskDefaults({ set: { worktree: true } })).rejects.toMatchObject(unsupported);
    await expect(applyHostRemoteDraftPreference({ agent: 'codex', providerId: 'p', modelId: 'm', active: true })).rejects.toMatchObject(unsupported);
    await expect(applyHostModelEffort({ agent: 'codex', providerId: 'p', modelId: 'm', effort: 'low' })).rejects.toMatchObject(unsupported);
    await expect(saveNewTaskPreferenceHistory({}, { dataOwnerId: 'owner-a', ownerGeneration: 1 }, 'r', true)).rejects.toMatchObject(unsupported);
    expect(fs.readdirSync(host.root)).toEqual([]);
  });
});
