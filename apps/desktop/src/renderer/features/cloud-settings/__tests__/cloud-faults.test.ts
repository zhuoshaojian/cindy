// @vitest-environment jsdom
// The write gate of the dev options' simulated frames (cloudFaults.ts). Tier: unit. Why: the owner
// simulates frames on a dev build connected to a real instance (Lead T28, owner: "模拟期间任何一条
// 写入都不能发到真实的云端 Cindy"). Whatever frame is chosen, no request that changes an instance
// leaves the page through any exit, the instance's channels are answered by the frame, and with no
// frame chosen everything goes out as before. A release build never reads the choice.
import { afterEach, expect, it, vi } from 'vitest';
import {
  activeCloudStage,
  endCloudStage,
  gatedCloudSettings,
  invokeCloudChannel,
  refuseWhileSimulating,
  selectCloudFrame,
} from '../cloudFaults';
import { CLOUD_SCENARIOS } from '../cloudFaultScripts';
import { createCloudImCaller } from '../cloudImTarget';
import { invokePluginManagement } from '@/features/plugin/remotePluginManagementClient';
import { invokeRemoteSkills } from '@/features/skillhub/remoteSkillsClient';
import { checkRemoteResource } from '@/features/plugin/remoteResourceGuard';

const CLOUD = 'cloud-device-' + 'a'.repeat(24);
const FRAMES = CLOUD_SCENARIOS.flatMap((scenario) =>
  scenario.frames.map((frame, index) => ({ scenario: scenario.id, index, label: `${frame.code} ${frame.name}` })),
);
afterEach(() => {
  endCloudStage();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps a dev choice for this run only and never reads it in a release build', () => {
  selectCloudFrame('card', 5, CLOUD);
  expect(JSON.parse(sessionStorage.getItem('cloud-preview:stage')!)).toEqual({
    scenario: 'card',
    frame: 5,
    deviceId: CLOUD,
  });
  expect(localStorage.length).toBe(0);
  endCloudStage();
  expect(sessionStorage.getItem('cloud-preview:stage')).toBeNull();
  vi.stubEnv('DEV', false);
  const read = vi.spyOn(Storage.prototype, 'getItem');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  selectCloudFrame('card', 5, CLOUD);
  expect(activeCloudStage()?.code).toBe('32H');
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

const BRIDGE_WRITES: [string, unknown][] = [
  ['instanceClaim', {}],
  ['instanceInitialize', { deviceId: CLOUD }],
  ['instanceLoginStart', { deviceId: CLOUD }],
  ['instanceLoginDispatch', { handle: 'h' }],
  ['instanceUpgrade', { deviceId: CLOUD, requestId: 'r' }],
  ['instancePower', { deviceId: CLOUD, action: 'sleep' }],
  ['instancePolicy', { deviceId: CLOUD, change: {} }],
  ['save', { handle: 'h', change: {} }],
  ['cancelAuthorizations', { handle: 'h' }],
  ['manage', { handle: 'h', command: { operation: 'run', actionId: 'a', operationId: 'o', values: {} } }],
  ['manage', { handle: 'h', command: { operation: 'cancel', operationId: 'o' } }],
  ['manage', { handle: 'h', command: { operation: 'respond', operationId: 'o', value: 'v' } }],
];
const BRIDGE_READS: [string, unknown][] = [
  ['instanceList', {}],
  ['instanceRead', { deviceId: CLOUD }],
  ['read', { handle: 'h', domains: [] }],
  ['manage', { handle: 'h', command: { operation: 'list', section: 'bots', offset: 0 } }],
  ['manage', { handle: 'h', command: { operation: 'status', operationId: 'o' } }],
];
const CHANNEL_WRITES: [string, unknown[]][] = [
  ['cloud:im-settings:v1', [{ call: 'maker:hook-control:set-enabled', args: [true] }]],
  ['cloud:im-settings:v1', [{ call: 'telegramBot:set-persona', args: [] }]],
  ['cloud:im-settings:v1', [{ call: 'wechatBot:reset-working-directory', args: [] }]],
  ['cloud:personalization:v1', [{ op: 'save' }]],
  ['cloud:personalization:v1', [{ op: 'reset' }]],
  ['cloud:provider-settings:v1', [{ op: 'custom-create' }]],
  ['cloud:provider-settings:v1', [{ op: 'custom-delete' }]],
  ['cloud:provider-settings:v1', [{ op: 'setup-stage' }]],
  ['cloud:provider-settings:v1', [{ op: 'remote-access' }]],
  ['cloud:provider-settings:v1', [{ op: 'model-edit' }]],
  ['cloud:provider-settings:v1', [{ op: 'xd', action: 'rotate' }]],
  ['cloud:provider-settings:v1', [{ op: 'share', command: { action: 'leave' } }]],
  ['some:unknown:channel', [{}]],
];
const CHANNEL_READS: [string, unknown[]][] = [
  ['cloud:im-settings:v1', [{ call: 'maker:hook-control:get', args: [] }]],
  ['cloud:personalization:v1', [{ op: 'read' }]],
  ['cloud:storage-usage:v1', [{ op: 'read' }]],
  ['cloud:provider-settings:v1', [{ op: 'list' }]],
  ['cloud:provider-settings:v1', [{ op: 'xd', action: 'status' }]],
  ['maker:usage:account', ['claude-code', {}]],
];
it.each(FRAMES)('sends nothing that changes the instance while $label is shown', async ({ scenario, index }) => {
  const methods = Object.fromEntries(
    [...BRIDGE_WRITES, ...BRIDGE_READS].map(([name]) => [name, vi.fn(async () => [])]),
  );
  const invoke = vi.fn(async () => ({}));
  vi.stubGlobal('electronAPI', { cloudSettings: methods, deviceLink: { invoke } });
  selectCloudFrame(scenario, index, CLOUD);
  const bridge = gatedCloudSettings(methods) as Record<string, (input: unknown) => Promise<unknown>>;
  for (const [name, input] of BRIDGE_WRITES)
    await expect(bridge[name]!(input), name).rejects.toThrow('CLOUD_SETTINGS_NOT_READY');
  for (const [channel, args] of CHANNEL_WRITES)
    await expect(invokeCloudChannel(CLOUD, channel, args), channel).rejects.toThrow('NOT_READY');
  expect(() => refuseWhileSimulating()).toThrow('NOT_READY');
  for (const name of new Set(BRIDGE_WRITES.map(([n]) => n)))
    if (name !== 'manage') expect(methods[name], name).not.toHaveBeenCalled();
  expect(methods.manage).not.toHaveBeenCalled();
  // The instance's channels are the frame's: reads are answered here, never sent.
  // (A frame still loading never answers; nothing waits for it here.)
  for (const [channel, args] of CHANNEL_READS) void invokeCloudChannel(CLOUD, channel, args).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(invoke).not.toHaveBeenCalled();
  // The frame's own settings page saves and authorizes nothing either.
  const settings = activeCloudStage()?.world.settings?.client;
  if (settings) {
    const [state] = await settings.read(['agentResource']).catch(() => [undefined] as const);
    if (state) await expect(settings.save(state, { maxConcurrentCommands: 2 })).rejects.toThrow('NOT_READY');
    await expect(
      settings.manage!({ operation: 'run', actionId: 'a', operationId: 'o', values: {} }),
    ).rejects.toThrow('NOT_READY');
  }
  // Reads of the bridge still go out (the live list underneath), so the page is the real one after.
  for (const [name, input] of BRIDGE_READS) await bridge[name]!(input);
  expect(methods.manage).toHaveBeenCalledTimes(2);
  // Ended: writes go out as before.
  endCloudStage();
  await bridge.save!({ handle: 'h', change: {} });
  await invokeCloudChannel(CLOUD, 'cloud:personalization:v1', [{ op: 'save' }]);
  expect(methods.save).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('sends nothing on the IM channel while simulating, writes included', async () => {
  const invoke = vi.fn(async () => ({ ownerGeneration: 1, result: null }));
  vi.stubGlobal('electronAPI', { deviceLink: { invoke } });
  const call = createCloudImCaller(CLOUD);
  selectCloudFrame('im', 2, CLOUD);
  await expect(call('maker:hook-control:get')).rejects.toThrow('DEVICE_LINK_TIMEOUT');
  await expect(call('maker:hook-control:set-enabled', { enabled: true })).rejects.toThrow('NOT_READY');
  expect(invoke).not.toHaveBeenCalled();
});

// Lead T33, 2026-11-11: the instance's plugin page (CloudPluginManagement, the remote plugin and
// skill pages) installs, removes, enables and sets preferences over DeviceLink. While simulating,
// none of those writes reaches a cloud instance; reads do unless the frame fails them, and other
// computers are untouched.
it('holds back plugin and skill writes to a cloud instance while simulating, and only those', async () => {
  const invoke = vi.fn(async () => ({ result: {} }));
  vi.stubGlobal('electronAPI', { deviceLink: { invoke } });
  selectCloudFrame('card', 0, CLOUD);
  for (const action of ['begin', 'answer', 'cancel', 'preferences-set', 'ui-consent', 'project-select'])
    await expect(invokePluginManagement(CLOUD, action), action).rejects.toThrow('CLOUD_SETTINGS_NOT_READY');
  for (const action of ['begin', 'answer', 'cancel'])
    await expect(invokeRemoteSkills(CLOUD, action), action).rejects.toThrow('CLOUD_SETTINGS_NOT_READY');
  expect(() => checkRemoteResource(CLOUD, 'device-link:pick-plugin-package')).toThrow('CLOUD_SETTINGS_NOT_READY');
  expect(invoke).not.toHaveBeenCalled();
  await invokePluginManagement(CLOUD, 'snapshot');
  await invokeRemoteSkills(CLOUD, 'catalog');
  expect(invoke).toHaveBeenCalledTimes(2);
  await invokePluginManagement('desktop-1', 'begin');
  expect(invoke).toHaveBeenCalledTimes(3);
  // 34: the plugin page cannot be read.
  selectCloudFrame('plugins', 1, CLOUD);
  await expect(invokePluginManagement(CLOUD, 'snapshot')).rejects.toThrow('DEVICE_LINK_TIMEOUT');
  expect(invoke).toHaveBeenCalledTimes(3);
  endCloudStage();
  await invokePluginManagement(CLOUD, 'begin');
  expect(invoke).toHaveBeenCalledTimes(4);
});
