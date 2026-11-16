// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudSettingsState } from '../../../../shared/cloudSettings';

const views = vi.hoisted(() => ({ bots: vi.fn(), subagent: vi.fn(), vision: vi.fn(), auxiliary: vi.fn(), catalog: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/bots/BotsGlobalSettingsSection', () => ({
  BotsGlobalSettingsSectionView: (props: Record<string, unknown>) => {
    views.bots(props);
    return <div data-testid="bots" />;
  },
}));
vi.mock('@/components/settings/SubagentModelSection', () => ({
  SubagentModelSectionView: (props: Record<string, unknown>) => {
    views.subagent(props);
    return <div data-testid="subagent" />;
  },
}));
vi.mock('@/components/settings/VisionBridgeSection', () => ({
  VisionBridgeSectionView: (props: Record<string, unknown>) => {
    views.vision(props);
    return null;
  },
}));
vi.mock('@/components/settings/AuxiliaryModelSection', () => ({
  AuxiliaryModelSectionView: (props: Record<string, unknown>) => {
    views.auxiliary(props);
    return null;
  },
}));
vi.mock('@/hooks/useDeviceProviders', () => ({
  useDeviceProviders: (deviceId: string) => {
    views.catalog(deviceId);
    return { providers: [{ id: 'target-provider' }], loading: false, error: null, unsupported: false };
  },
}));
import { toast } from '@/lib/toast';
import {
  CloudAuxiliarySettings,
  CloudBotsSettings,
  CloudSubagentSettings,
  CloudVisionBridgeSettings,
} from '../CloudModelSettings';
import { act } from '@testing-library/react';

const state = (domain: string, value: Record<string, unknown>, extra = {}) =>
  ({ domain, status: 'ready', revision: '1', value, defaults: {}, customizedKeys: [], ...extra }) as unknown as CloudSettingsState;
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0];
const route = { harness: 'claude', providerId: 'provider-a', model: 'model-a', effort: 'high', fastMode: false };

describe('cloud model settings', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('edits the bot chain on the target catalog and writes the settings contract shape', () => {
    const attempt = vi.fn(async () => true);
    render(
      <CloudBotsSettings
        state={state('botModelChain', { modelChain: [route] }, { isCustomized: true })}
        deviceId="cloud-device-a"
        disabled={false}
        attempt={attempt}
      />,
    );
    const props = last(views.bots);
    expect(props.deviceId).toBe('cloud-device-a');
    expect(props.modelChain).toMatchObject([{ harness: 'claude', model: 'model-a' }]);
    props.onChange([{ ...route, providerId: undefined, effort: undefined, fastMode: true }]);
    expect(attempt).toHaveBeenCalledWith('botModelChain', {
      modelChain: [{ harness: 'claude', providerId: null, model: 'model-a', effort: '', fastMode: true }],
    });
    props.onRestoreDefault();
    expect(attempt).toHaveBeenLastCalledWith('botModelChain', {}, ['modelChain']);
  });

  it('refuses routes the settings contract cannot carry instead of dropping their device', () => {
    const attempt = vi.fn(async () => true);
    render(
      <CloudBotsSettings state={state('botModelChain', { modelChain: [] })} deviceId="d" disabled={false} attempt={attempt} />,
    );
    const props = last(views.bots);
    expect(props.onRestoreDefault).toBeUndefined();
    props.onChange([{ ...route, agentDeviceId: 'other-device' }]);
    props.onChange([{ ...route, fastMode: 'ultrafast' }]);
    expect(attempt).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('saves the Claude Subagent route and restores each field independently', async () => {
    const attempt = vi.fn(async () => true);
    render(
      <CloudSubagentSettings
        state={state(
          'subagentModel',
          { claudeCode: { providerId: 'gone', modelId: 'model-a' }, codexSmartSubagentRouting: true },
          {
            customizedKeys: ['claudeCode'],
            choices: { claudeCode: [{ value: { providerId: 'provider-a', modelId: 'model-a' }, label: 'A' }] },
          },
        )}
        deviceId="cloud-device-a"
        disabled={false}
        attempt={attempt}
      />,
    );
    const props = last(views.subagent);
    expect(props).toMatchObject({
      claudeCode: 'model-a',
      claudeCodeProviderId: 'gone',
      codexSmartSubagentRouting: true,
      claudeCustomized: true,
      smartRoutingCustomized: false,
      claudeSourceDisconnected: true,
      deviceId: 'cloud-device-a',
    });
    await props.setClaudeModel('model-b', 'provider-a');
    expect(attempt).toHaveBeenLastCalledWith('subagentModel', {
      claudeCode: { providerId: 'provider-a', modelId: 'model-b' },
    });
    await props.setClaudeModel(null, null);
    expect(attempt).toHaveBeenLastCalledWith('subagentModel', { claudeCode: null });
    props.resetClaude();
    expect(attempt).toHaveBeenLastCalledWith('subagentModel', {}, ['claudeCode']);
    props.setSmartRouting(false);
    expect(attempt).toHaveBeenLastCalledWith('subagentModel', { codexSmartSubagentRouting: false });
    props.resetSmartRouting();
    expect(attempt).toHaveBeenLastCalledWith('subagentModel', {}, ['codexSmartSubagentRouting']);
    expect(screen.getByTestId('subagent')).toBeTruthy();
  });

  it('drives the vision bridge from the target catalog without a picker deviceId', async () => {
    const attempt = vi.fn(async () => true);
    render(
      <CloudVisionBridgeSettings
        state={state(
          'visionBridge',
          { enabled: true, primary: { providerId: 'p', modelId: 'm' }, fallback: null, targetModels: ['a'] },
          { customizedKeys: ['targetModels'], isCustomized: true },
        )}
        deviceId="cloud-device-a"
        disabled={false}
        attempt={attempt}
      />,
    );
    expect(views.catalog).toHaveBeenCalledWith('cloud-device-a');
    const props = last(views.vision);
    expect(props).toMatchObject({
      providers: [{ id: 'target-provider' }],
      enabled: true,
      primary: { providerId: 'p', modelId: 'm' },
      fallback: null,
      targetModels: ['a'],
      targetModelsCustomized: true,
    });
    expect(props.deviceId).toBeUndefined();
    await expect(props.persistPatch({ enabled: false })).resolves.toBe(true);
    expect(attempt).toHaveBeenLastCalledWith('visionBridge', { enabled: false });
    await props.resetTargetModels();
    expect(attempt).toHaveBeenLastCalledWith('visionBridge', {}, ['targetModels']);
  });

  it('offers target auxiliary pins, keeps missing saved pins visible and clears to automatic', async () => {
    const attempt = vi.fn(async () => true);
    const offered = 'cat:provider-a:codex:model-a';
    render(
      <CloudAuxiliarySettings
        state={state(
          'auxiliaryModel',
          { models: [offered, 'cat:gone:pi:model-b'] },
          { choices: { models: [{ value: offered, label: 'Codex · Model A · Provider A' }] } },
        )}
        disabled={false}
        attempt={attempt}
      />,
    );
    let props = last(views.auxiliary);
    expect(props.signInHint).toBe(false);
    expect(props.options).toMatchObject([
      { id: offered, group: 'Provider A', modelName: 'Model A', agentKind: 'codex', providerId: 'provider-a', available: true },
      { id: 'cat:gone:pi:model-b', providerId: 'gone', available: false },
    ]);
    await act(async () => props.setDrafting(true));
    props = last(views.auxiliary);
    expect(props.drafting).toBe(true);
    await expect(props.persistModels([offered])).resolves.toBe(true);
    expect(attempt).toHaveBeenLastCalledWith('auxiliaryModel', { models: [offered] }, undefined);
    await act(async () => {
      await props.persistModels([]);
    });
    expect(attempt).toHaveBeenLastCalledWith('auxiliaryModel', {}, ['models']);
    expect(last(views.auxiliary).drafting).toBe(false);
  });
});
