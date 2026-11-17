// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderView } from '@cindy/model-providers';
import type { AgentCapabilities } from '@/hooks/useAgentCapabilities';
import { getDataOwnerGeneration, setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
import { useRemoteDraftDefaults, useRemoteDraftSelection } from '../useRemoteDraftDefaults';

// Unit: the production read and selection hooks with only the device-link transport replaced.
// Entering a managed cloud instance seeds the draft engine from the instance's new-task
// engine; entering any other computer keeps the current engine, as upstream does.
const CLOUD_DEVICE = 'cloud-device-0123456789abcdef01234567';
const piProvider: ProviderView = {
  id: 'xd', name: 'xd', source: 'managed', connected: true, agents: ['pi'],
  auth: { method: 'managed' }, access: { kind: 'managed' },
  routing: { pi: { upstream: 'https://models.example.invalid', authStrategy: 'none' } },
  models: { pi: [{ id: 'usable', name: 'usable', contextWindow: 200_000, efforts: ['medium'], defaultEffort: 'medium' }] },
} as unknown as ProviderView;
const capabilities: AgentCapabilities = {
  availableModels: [{ id: 'usable', displayName: 'usable', efforts: [], contextWindow: 100_000, defaultEffort: null }],
  permissionModes: [], effortLevels: [], hasFastMode: false,
};

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => setDataOwnerGeneration('agent-seed-test'));
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.unstubAllGlobals(); });

async function enter(deviceId: string) {
  const switchDraftVendor = vi.fn();
  const invoke = vi.fn(async () => ({ preferredAgentKind: 'pi', defaultTupleCustomized: true }));
  Object.assign(window, { electronAPI: { deviceLink: { invoke, onPresenceChanged: () => () => {}, onStatusChanged: () => () => {}, onRemotePush: () => () => {} } } });
  const { dataOwnerId, generation } = getDataOwnerGeneration();
  function Harness() {
    const remoteDefaults = useRemoteDraftDefaults({
      isDeviceLinkDraft: true, effectiveDeviceLinkDeviceId: deviceId, capabilityAgentKind: 'codex',
      wtPreferenceTransactionRef: { current: null }, dataOwnerId, dataOwnerGeneration: generation,
    });
    useRemoteDraftSelection({
      remoteDefaults, usesDeviceCatalog: true, catalogDeviceId: deviceId, capabilityAgentKind: 'codex',
      agentCatalogProviders: [piProvider], capabilities, capabilitiesLoading: false,
      deviceProvidersUnsupported: false, deviceProvidersLoading: false,
      deviceDraftDefaultsReady: remoteDefaults.remoteDraftState.status === 'ready',
      deviceDraftDefaults: remoteDefaults.remoteDraftState.value, isAgentDeviceDraft: false,
      availableAgentsLoaded: true, availableVendors: new Set(['cc', 'codex', 'pi']),
      deviceProvidersError: null, dataOwnerId, switchDraftVendor,
    });
    return null;
  }
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Harness)));
  return switchDraftVendor;
}

it.each([
  { deviceId: 'desk-device-1', switched: [] },
  { deviceId: CLOUD_DEVICE, switched: [['pi']] },
])('seeds the draft engine from the remote new-task engine only on a managed cloud instance: $deviceId', async ({ deviceId, switched }) => {
  const switchDraftVendor = await enter(deviceId);
  expect(switchDraftVendor.mock.calls).toEqual(switched);
});
