import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(__dirname, '..', 'features', 'cc-agent', 'NewMakerDraftRoute.tsx'),
  'utf8',
).replace(/\r\n?/g, '\n');
const chatInput = readFileSync(
  resolve(__dirname, '..', 'components', 'new-chat', 'ChatInput.tsx'),
  'utf8',
).replace(/\r\n?/g, '\n');
const modelSelector = readFileSync(
  resolve(__dirname, '..', 'components', 'new-chat', 'ModelSelector.tsx'),
  'utf8',
).replace(/\r\n?/g, '\n');
const zhCnMessages = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'i18n', 'locales', 'zh-CN', 'common.json'), 'utf8'),
) as {
  ccAgent: { draft: { cloudModelsLoading: string; cloudWakingSendBlocked: string } };
};

describe('inline cloud wake on the new-maker draft', () => {
  it('keeps the user on the transient draft and closes the device menu immediately', () => {
    expect(route).toContain('cloudWakeStatus');
    expect(route).not.toContain('navigate(\'/cc-agent/cloud-wake\'');
  });

  it('renders the wake status next to the real ChatInput without creating a session', () => {
    expect(route).toContain('ccAgent.draft.cloudWaking');
    expect(route).toContain("sendDisabled={cloudWakeStatus !== 'ready'}");
    expect(route).toContain('<ChatInput');
    expect(route).toContain('sessionId={undefined}');
  });

  it('blocks only submit while waking, not editor input', () => {
    expect(chatInput).toContain('sendDisabled?: boolean;');
    expect(chatInput).toContain('sendDisabled ||');
    expect(chatInput).toContain('if (sendDisabled) {');
    expect(route).toContain("if (cloudWakeStatus !== 'ready') return false;");
  });

  it('explains the waking send gate without changing the draft flow', () => {
    expect(chatInput).toContain('sendDisabledReason?: string;');
    expect(chatInput).toContain('notifySendDisabled();');
    expect(chatInput).toContain(': sendDisabledReason');
    expect(route).toContain(
      "sendDisabledReason={cloudWakeStatus === 'waking' ? t('ccAgent.draft.cloudWakingSendBlocked') : undefined}",
    );
    expect(zhCnMessages.ccAgent.draft.cloudWakingSendBlocked).toBe(
      '云端 Cindy 正在唤醒，唤醒完成后即可发送',
    );
  });

  it('reselects an already-waking cloud target without issuing another wake', () => {
    expect(route).toContain("cloud.pending?.action === 'wake'");
    expect(route).toContain('pendingWakeForTarget');
    expect(route).toContain('if (pendingWakeForTarget) return;');
  });

  it('does not promote relay presence before the existing wake terminal watch finishes', () => {
    const effectStart = route.indexOf('// 只有 relay 真正上线后');
    const pendingGate = route.indexOf("if (cloud.pending?.action === 'wake') return;", effectStart);
    const activation = route.indexOf(
      'activateCloudDevice(pendingCloudTarget.deviceId, pendingCloudTarget.deviceName);',
      effectStart,
    );
    expect(pendingGate).toBeGreaterThan(effectStart);
    expect(activation).toBeGreaterThan(pendingGate);
  });

  it('treats a pending cloud target as distinct from local when the user selects local', () => {
    expect(route).toContain('&& pendingCloudTarget == null) return;');
  });

  it('shows a cloud-model loading placeholder instead of the local draft model while waking', () => {
    expect(route).toContain(
      "const cloudModelsLoading = cloudWakeStatus === 'waking' || remoteModelListStatus === 'loading';",
    );
    expect(route).toContain(
      "modelLoadingLabel={cloudModelsLoading ? t('ccAgent.draft.cloudModelsLoading') : undefined}",
    );
    expect(chatInput).toContain('modelLoadingLabel?: string;');
    expect(chatInput).toContain('loadingLabel={modelLoadingLabel}');
    expect(modelSelector).toContain('const forcedLoading = Boolean(loadingLabel);');
    expect(modelSelector).toContain('const displayLabel = loadingLabel ??');
    expect(zhCnMessages.ccAgent.draft.cloudModelsLoading).toBe('云端模型加载中…');
  });

  it('locks Agent, model, and source selection while the cloud target is waking', () => {
    expect(route.match(/disabled=\{wtCreating \|\| cloudModelsLoading\}/g)).toHaveLength(2);
    expect(chatInput).toContain(
      'disabled={\n                      disabled ||\n                      settingsLocked ||\n                      Boolean(modelLoadingLabel) ||',
    );
  });

  it('uses the shared progress color and breathing motion for the inline wake status', () => {
    expect(route).toContain(
      'session-status-breathing text-[var(--remote-status-progress)] motion-reduce:animate-none',
    );
    expect(route).not.toContain(
      'animate-pulse text-[var(--folder-item-icon)] motion-reduce:animate-none',
    );
  });
});
