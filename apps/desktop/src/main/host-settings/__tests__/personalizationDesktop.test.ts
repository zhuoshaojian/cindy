import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ root: '', instance: null as object | null }));
vi.mock('electron', () => ({ app: { getPath: () => host.root } }));
vi.mock('../../instance-runtime/config.js', () => ({ getInstanceConfig: () => host.instance }));
vi.mock('../../appSessionState.js', () => ({
  dataOwnerStorageKey: (id: string) => `test-${id}`,
  peekCommittedAppSession: () => ({ mode: 'local', dataOwnerId: 'owner-a', generation: 1 }),
  isAppSessionBoundaryPending: () => false,
}));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ info() {}, warn() {} }) }));
import { commitPersonalization, importLegacyPersonalization, inspectPersonalization, inspectPersonalizationForSnapshot } from '../personalization';
import { captureHostPersonalization } from '../startup';

beforeEach(() => { host.root = fs.mkdtempSync(path.join(os.tmpdir(), 'personalization-desktop-')); host.instance = null; });
afterEach(() => fs.rmSync(host.root, { recursive: true, force: true }));

describe('personalization on an ordinary desktop', () => {
  it('keeps the prompt the renderer sent and never reads or creates the Host file', () => {
    const opts = { userPrompt: 'from renderer', makerMemoryEnabled: true, displayReasoning: 'summarized' as const };
    captureHostPersonalization(opts);
    expect(opts).toMatchObject({ userPrompt: 'from renderer', hostStartupPreferences: { userPrompt: 'from renderer', makerMemoryEnabled: true } });
    expect(inspectPersonalization()).toEqual({ status: 'unavailable', revision: null });
    expect(inspectPersonalizationForSnapshot()).toEqual({ status: 'unavailable', revision: null });
    expect(fs.readdirSync(host.root)).toEqual([]);
  });

  it('rejects Host writes', async () => {
    await expect(commitPersonalization({ set: { userPrompt: 'x' } })).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    await expect(importLegacyPersonalization('x', { dataOwnerId: 'owner-a', ownerGeneration: 1 }, 'r')).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    expect(fs.readdirSync(host.root)).toEqual([]);
  });
});

describe('personalization on a managed cloud instance', () => {
  it('replaces the controller copy with the Host prompt', async () => {
    host.instance = {};
    const state = inspectPersonalization();
    if (state.status !== 'ready') throw new Error('fixture unreadable');
    await commitPersonalization({ set: { userPrompt: 'from host' } }, { expectedRevision: state.revision });
    const opts = { userPrompt: 'from controller', makerMemoryEnabled: false, displayReasoning: 'summarized' as const };
    captureHostPersonalization(opts);
    expect(opts).toMatchObject({ userPrompt: 'from host', hostStartupPreferences: { userPrompt: 'from host' } });
  });
});
