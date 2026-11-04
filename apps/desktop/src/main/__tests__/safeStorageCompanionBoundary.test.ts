import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScriptTarget, transpileModule } from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { companionEnvironmentKey } from '../bot-import/environment.js';
import { isRendererAccessibleSafeStorageKey, isCustomProviderRuntimeKeyStorageKey,
  customProviderSecretStorageKey, customMcpSecretStorageKey, providerOAuthStorageKey,
  providerSecretStorageKey, MCP_APP_REVISION_KEY_STORAGE_KEY } from '../../shared/providerSecrets.js';

// Execute the production registrations with fake Electron dependencies, without
// launching Desktop or reproducing the IPC handlers in a test implementation.
const source = fs.readFileSync(new URL('../bootstrap-electron.ts', import.meta.url), 'utf8');
const start = source.indexOf('// safeStorage IPC handlers');
const end = source.indexOf('const builtinApiKeyLog =', start);
if (start < 0 || end <= start) throw new Error('safeStorage registration block not found');
const compiled = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
type Handler = (event: object, key: string, value?: string) => Promise<unknown>;
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-companion-bridge-test-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function bridge({ cloud = false }: { cloud?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const log = { error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  const deps = {
    ipcMain: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); } },
    isRendererAccessibleSafeStorageKey, isCustomProviderRuntimeKeyStorageKey,
    assertTrustedAppRendererEvent: vi.fn(),
    resolveOwnerScopedSecretStorageKey: vi.fn((key: string) => `owner_fixture_${key}`),
    app: { getPath: () => root }, fs, path, Buffer,
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((value: string) => Buffer.from(`fixture:${value}`)),
      decryptString: vi.fn((value: Buffer) => value.toString().slice('fixture:'.length)),
    },
    getCodexProxyAuthInjectionState: () => 'oauth-bearer',
    noteManualXdKeySaved: vi.fn(), noteManualXdKeyRemoved: vi.fn(),
    getGhostSetupChangeBus: () => ({ emitAll: vi.fn() }),
    BrowserWindow: { getAllWindows: () => [] },
    safeStorageReadLog: log, console: log,
    isIpcError: () => false,
    throwIpcError: (_code: string, message: string) => { throw new Error(message); },
    // Cloud management registers the same handler; only its closed call reaches it.
    cloudManagementProviderRegistry: (registry: unknown) => registry,
    isCloudManagementInvocation: () => cloud,
    providerSecretStorageKey,
  };
  new Function(...Object.keys(deps), compiled)(...Object.values(deps));
  expect([...handlers.keys()]).toEqual(['safe-storage-store', 'safe-storage-read', 'safe-storage-remove']);
  return { ...deps, invoke: (operation: string, key: string, value?: string) => handlers.get(`safe-storage-${operation}`)!({}, key, value) };
}

describe('generic safeStorage companion boundary', () => {
  it.each([
    ['read', null], ['store', false], ['remove', { success: false, error: 'invalid key' }],
  ])('denies %s before resolving a path, touching the vault or changing stored data', async (operation, result) => {
    const api = bridge();
    const key = companionEnvironmentKey('fixture-companion');
    const directory = path.join(root, 'safe-storage');
    fs.mkdirSync(directory);
    const file = path.join(directory, `owner_fixture_${key}.enc`);
    // Legacy data remains readable to Main and must not escape via generic IPC;
    // writes/deletes must not corrupt either old or chunked environment files.
    const original = Buffer.from('fixture:{"env":{"KEY":"fixture-private-token"}}').toString('base64');
    fs.writeFileSync(file, original);
    for (const variant of [key, key.toUpperCase(), 'bot_environment_future_format', 'bot_environment_',
      MCP_APP_REVISION_KEY_STORAGE_KEY, MCP_APP_REVISION_KEY_STORAGE_KEY.toUpperCase()]) {
      expect(await api.invoke(String(operation), variant, 'replacement')).toEqual(result);
    }
    expect(api.assertTrustedAppRendererEvent).toHaveBeenCalledTimes(6);
    expect(api.resolveOwnerScopedSecretStorageKey).not.toHaveBeenCalled();
    expect(api.safeStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(api.safeStorage.decryptString).not.toHaveBeenCalled();
    expect(api.safeStorage.encryptString).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.readdirSync(directory)).toEqual([path.basename(file)]);
  });

  it.each(['api_key', customProviderSecretStorageKey('fixture-provider', 'codex'),
    customMcpSecretStorageKey('fixture-mcp'), providerOAuthStorageKey('fixture-oauth')])('preserves ordinary Renderer credential operations for %s', async key => {
    const api = bridge();
    expect(await api.invoke('store', key, 'fixture-ordinary-token')).toBe(true);
    expect(await api.invoke('read', key)).toBe('fixture-ordinary-token');
    expect(await api.invoke('remove', key)).toEqual({ success: true });
    expect(await api.invoke('read', key)).toBeNull();
    expect(api.safeStorage.encryptString).toHaveBeenCalledTimes(1);
    expect(api.safeStorage.decryptString).toHaveBeenCalledTimes(1);
  });
});

describe('cloud providers page removal', () => {
  it('removes only the Cindy AI key through cloud management', async () => {
    const api = bridge({ cloud: true });
    expect(await api.invoke('remove', customProviderSecretStorageKey('fixture-provider', 'codex'))).toEqual({
      success: false, error: 'invalid key',
    });
    expect(api.assertTrustedAppRendererEvent).not.toHaveBeenCalled();
    expect(api.resolveOwnerScopedSecretStorageKey).not.toHaveBeenCalled();
    expect(await api.invoke('remove', 'api_key')).toEqual({ success: true });
    expect(api.noteManualXdKeyRemoved).toHaveBeenCalledOnce();
  });
});
