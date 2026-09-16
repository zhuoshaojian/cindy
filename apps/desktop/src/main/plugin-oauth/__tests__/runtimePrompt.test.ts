import { beforeEach, expect, it, vi } from 'vitest';
import {
  buildDesktopClaudeRuntimeConfig,
  desktopCodexRuntimeConfig,
} from '../../maker-host/runtime-configs.js';
import { CLOUD_PLUGIN_OAUTH_PROMPT } from '../prompt.js';

const instance = vi.hoisted(() => ({ cloud: false }));
vi.mock('../../instance-runtime/config.js', () => ({
  getInstanceConfig: () => (instance.cloud ? { membershipId: 'synthetic-member' } : null),
}));
beforeEach(() => {
  instance.cloud = false;
});

it('uses actual Claude/Codex Host getters to append only for a configured cloud instance', () => {
  for (const config of [
    buildDesktopClaudeRuntimeConfig(() => 'https://model.example'),
    desktopCodexRuntimeConfig,
  ]) {
    const local = config.systemPrompt!;
    instance.cloud = true;
    expect(config.systemPrompt).toBe(local + '\n\n' + CLOUD_PLUGIN_OAUTH_PROMPT);
    expect(config.systemPrompt).toBe(config.systemPrompt);
    instance.cloud = false;
    expect(config.systemPrompt).toBe(local);
  }
});
