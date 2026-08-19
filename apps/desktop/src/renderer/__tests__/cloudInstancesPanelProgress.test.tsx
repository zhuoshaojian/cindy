// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudInstancesPanel } from '../components/settings/CloudInstancesPanel';
import type {
  CloudInstanceView,
  UseCloudInstances,
} from '../features/cloud-instance/useCloudInstances';
import type { DeviceLinkSettings } from '../hooks/useDeviceLinkSettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => false) }),
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

function replacementInstance(): CloudInstanceView {
  return {
    instanceId: 'instance-new',
    deviceId: 'device-new',
    nameSequence: 2,
    customLabel: null,
    status: {
      instanceId: 'instance-new',
      deviceId: 'device-new',
      ownership: {
        passportId: 'passport-a',
        membershipId: 'membership-a',
        membershipKind: 'personal',
        orgSlug: null,
      },
      desiredState: 'running',
      nextWakeAtMs: null,
      runtimeState: 'running',
      resourceTier: 'small',
      readiness: { ready: false, reason: 'runtime-not-ready', blockers: [] },
      upgrade: {
        state: 'idle',
        targetImage: null,
        previousImage: null,
        deadlineAtMs: null,
      },
      autoUpdate: false,
      updatedAtMs: 1_000,
    },
  };
}

function settingsWithoutRelayDevice(): DeviceLinkSettings {
  return {
    devices: [],
    refresh: vi.fn(async () => []),
  } as unknown as DeviceLinkSettings;
}

function rebuildingCloud(): UseCloudInstances {
  return {
    instances: [replacementInstance()],
    loadState: 'ready',
    pending: { target: 'instance-old', action: 'rebuild' },
    rebuildRetirement: null,
    clearRebuildRetirement: vi.fn(),
    onlineDeviceIds: new Set(),
    refresh: vi.fn(async () => undefined),
    wake: vi.fn(async () => undefined),
    stopInstance: vi.fn(async () => undefined),
    upgradeInstance: vi.fn(async () => undefined),
    rebuildInstance: vi.fn(async () => undefined),
    setAutoUpdate: vi.fn(async () => true),
    deleteInstance: vi.fn(async () => undefined),
  };
}

afterEach(() => cleanup());

describe('CloudInstancesPanel lifecycle progress', () => {
  it('shows rebuilding on an unregistered replacement card when pending targets the retired instance', () => {
    render(
      <CloudInstancesPanel
        s={settingsWithoutRelayDevice()}
        cloud={rebuildingCloud()}
      />,
    );

    const card = screen.getByTestId('cloud-instance-unregistered-card');
    const rebuildButton = within(card).getByTestId('cloud-instance-rebuild');
    expect(rebuildButton.textContent).toContain('settings.devices.cloudInstance.rebuilding');
    expect(rebuildButton.textContent).not.toBe('settings.devices.cloudInstance.rebuild');
  });
});
