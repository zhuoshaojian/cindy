// Unit: the cloud providers page channel. Owner-gated, full catalog including hidden models,
// display-only routing, and every write delegated to the exact native Host channel.
import { describe, expect, it, vi } from 'vitest';
import {
  createProviderSettingsChannel,
  type ProviderSettingsChannelDeps,
} from '../providerSettingsChannel';
import type { ModelPresentationPreferencesSnapshot } from '../../../shared/modelPresentationPreferences';

const OWNER = { dataOwnerId: 'owner-1', ownerGeneration: 7 };
const snapshot = (revision: string, overrides: Record<string, boolean>) =>
  ({
    status: 'ready',
    ownerStamp: OWNER,
    revision,
    initialized: true,
    value: { visibility: { overrides, initialization: {} }, engines: {}, favorites: {} },
  }) as unknown as ModelPresentationPreferencesSnapshot;

function setup(overrides: Partial<ProviderSettingsChannelDeps> = {}) {
  let owner: typeof OWNER | null = OWNER;
  let isOwner = true;
  const call = vi.fn<ProviderSettingsChannelDeps['call']>(async (channel) =>
    channel === 'maker:provider:list'
      ? {
          dataOwnerId: OWNER.dataOwnerId,
          ownerGeneration: OWNER.ownerGeneration,
          providerOrder: ['xd', 'openai'],
          modelVisibilityOverrides: {},
          providers: [
            {
              id: 'xd',
              name: 'Cindy AI',
              connected: true,
              remoteInvocationEnabled: false,
              remoteModelIds: ['secret-share'],
              logoKind: 'forged',
              routing: {
                codex: {
                  upstream: 'https://internal.example.invalid',
                  authStrategy: 'bearer',
                  wireProtocol: 'openai-responses',
                },
              },
              models: {
                codex: [
                  { id: 'shown', name: 'Shown' },
                  { id: 'hidden', name: 'Hidden', defaultEnabled: false },
                  { id: 'paid', name: 'Paid', availability: 'requires_payment' },
                ],
              },
            },
          ],
        }
      : undefined,
  );
  const mutateVisibility = vi.fn(async () => ({
    snapshot: snapshot('rev-2', { 'codex:xd:hidden': true }),
  }));
  const deps: ProviderSettingsChannelDeps = {
    isInstanceOwner: () => isOwner,
    owner: () => owner,
    call,
    inspectVisibility: () => snapshot('rev-1', { 'codex:xd:hidden': false }),
    mutateVisibility,
    projectRouting: (routing) =>
      routing &&
      Object.fromEntries(
        Object.entries(routing as Record<string, { wireProtocol?: string }>).map(
          ([agent, route]) => [agent, { wireProtocol: route.wireProtocol }],
        ),
      ),
    resolveLogoKind: () => 'cindy',
    readEfforts: () => ({ 'codex:*': { shown: 'high' } }),
    applyEffort: vi.fn(async () => {}),
    editModel: vi.fn(async () => {}),
    shareCommand: vi.fn(async (command) => ({ command })),
    ...overrides,
  };
  return {
    channel: createProviderSettingsChannel(deps),
    call,
    deps,
    mutateVisibility,
    setOwner: (next: typeof OWNER | null) => {
      owner = next;
    },
    setIsOwner: (next: boolean) => {
      isOwner = next;
    },
  };
}
const run = (h: ReturnType<typeof setup>, request: unknown) =>
  h.channel.handle('same-account-mac', request);

describe('cloud provider settings channel', () => {
  it('refuses a non-owner before reading or writing anything', async () => {
    const h = setup();
    h.setIsOwner(false);
    await expect(run(h, { op: 'list' })).rejects.toThrow('[PERMISSION_DENIED]');
    expect(h.call).not.toHaveBeenCalled();
  });

  it('lists the full catalog, including hidden and payment-locked models, with display-only routing', async () => {
    const h = setup();
    type Model = { id: string; availability?: string };
    type Provider = {
      models: { codex: Model[] };
      routing: unknown;
      logoKind: string;
      remoteInvocationEnabled: boolean;
    };
    const list = (await run(h, { op: 'list' })) as {
      providers: Provider[];
      supportedOps: string[];
    };
    expect(h.call).toHaveBeenCalledWith('maker:provider:list', [], expect.any(Object));
    expect(list).toMatchObject({
      version: 1,
      ownerGeneration: 7,
      providerOrder: ['xd', 'openai'],
      visibility: { status: 'ready', revision: 'rev-1', overrides: { 'codex:xd:hidden': false } },
    });
    expect(list.supportedOps).toContain('visibility-set');
    const xd = list.providers[0];
    expect(xd.models.codex.map((m) => m.id)).toEqual(['shown', 'hidden', 'paid']);
    expect(xd.models.codex[2].availability).toBe('requires_payment');
    expect(xd.routing).toEqual({ codex: { wireProtocol: 'openai-responses' } });
    expect(xd.logoKind).toBe('cindy');
    expect(xd.remoteInvocationEnabled).toBe(false);
    expect(xd).not.toHaveProperty('remoteModelIds');
    expect(JSON.stringify(list)).not.toContain('internal.example.invalid');
    expect(JSON.stringify(list)).not.toContain('bearer');
  });

  it('refuses a catalog over the transfer limit', async () => {
    const h = setup({
      call: async () => ({
        providers: [{ id: 'big', name: 'x'.repeat(2 * 1024 * 1024 + 1) }],
        providerOrder: [],
      }),
    });
    await expect(run(h, { op: 'list' })).rejects.toThrow('[TOO_LARGE]');
  });

  it('delegates each write to its native channel with the Host owner, never the caller’s', async () => {
    const cases: Array<[unknown, string, unknown]> = [
      [
        {
          op: 'model-disable',
          ownerGeneration: 7,
          providerId: 'xd',
          kind: 'model',
          disabled: true,
          modelIds: ['shown'],
        },
        'maker:model-disable:set',
        { providerId: 'xd', kind: 'model', disabled: true, modelIds: ['shown'] },
      ],
      [
        { op: 'order', ownerGeneration: 7, providerIds: ['openai', 'xd'] },
        'maker:provider:order:set',
        { dataOwnerId: 'owner-1', ownerGeneration: 7, providerIds: ['openai', 'xd'] },
      ],
      [
        {
          op: 'presentation',
          ownerGeneration: 7,
          providerId: 'openai',
          action: 'rename',
          name: 'Work',
        },
        'maker:provider:presentation:set',
        {
          dataOwnerId: 'owner-1',
          ownerGeneration: 7,
          providerId: 'openai',
          action: 'rename',
          name: 'Work',
        },
      ],
      [
        { op: 'remote-access', ownerGeneration: 7, providerId: 'xd', enabled: true },
        'maker:provider:remote-access:set',
        { providerId: 'xd', enabled: true },
      ],
      [
        { op: 'refresh', ownerGeneration: 7, providerId: 'openai' },
        'maker:provider:models-refresh',
        'openai',
      ],
      [
        { op: 'rediscover', ownerGeneration: 7, providerId: 'anthropic' },
        'maker:provider:models-rediscover',
        'anthropic',
      ],
    ];
    for (const [request, channel, arg] of cases) {
      const h = setup();
      await expect(run(h, request)).resolves.toEqual({
        ok: true,
        ownerGeneration: 7,
        catalogChanged: true,
      });
      expect(h.call).toHaveBeenCalledTimes(1);
      expect(h.call).toHaveBeenCalledWith(channel, [arg], expect.any(Object));
    }
  });

  it('rejects a stale owner generation without calling the Host', async () => {
    const h = setup();
    await expect(run(h, { op: 'order', ownerGeneration: 6, providerIds: ['xd'] })).rejects.toThrow(
      '[OWNER_CHANGED]',
    );
    expect(h.call).not.toHaveBeenCalled();
  });

  it('fails a write whose owner changes while the Host handler runs', async () => {
    const h = setup();
    h.call.mockImplementationOnce(async () => {
      h.setOwner({ dataOwnerId: 'owner-2', ownerGeneration: 8 });
      return undefined;
    });
    await expect(
      run(h, { op: 'remote-access', ownerGeneration: 7, providerId: 'xd', enabled: true }),
    ).rejects.toThrow('[OWNER_CHANGED]');
  });

  it('writes visibility with compare-and-swap and returns the new state', async () => {
    const h = setup();
    const targets = [{ agent: 'codex', modelId: 'hidden' }];
    await expect(
      run(h, {
        op: 'visibility-set',
        ownerGeneration: 7,
        revision: 'rev-0',
        providerId: 'xd',
        targets,
        enabled: true,
      }),
    ).rejects.toThrow('[REVISION_CONFLICT]');
    expect(h.mutateVisibility).not.toHaveBeenCalled();
    await expect(
      run(h, {
        op: 'visibility-set',
        ownerGeneration: 7,
        revision: 'rev-1',
        providerId: 'xd',
        targets,
        enabled: true,
      }),
    ).resolves.toEqual({
      ok: true,
      ownerGeneration: 7,
      catalogChanged: false,
      visibility: { status: 'ready', revision: 'rev-2', overrides: { 'codex:xd:hidden': true } },
    });
    expect(h.mutateVisibility).toHaveBeenCalledWith(
      {
        ownerStamp: OWNER,
        expectedRevision: 'rev-1',
        operation: { kind: 'visibility-set', providerId: 'xd', targets, enabled: true },
      },
      expect.any(Function),
    );
  });

  it('rejects malformed requests and unknown operations', async () => {
    const h = setup();
    for (const bad of [
      null,
      {},
      { op: 'delete-everything' },
      { op: 'order', ownerGeneration: 7, providerIds: [] },
      { op: 'list', extra: true },
      { op: 'refresh', ownerGeneration: 7, providerId: 'xd', channel: 'maker:auth:logout' },
    ])
      await expect(run(h, bad)).rejects.toThrow('[INVALID_PARAMS]');
    expect(h.call).not.toHaveBeenCalled();
  });

  it('serves model panel calls with the instance owner stamp and returns their views', async () => {
    const f = setup();
    f.call.mockImplementation(async (channel) => ({ channel }));
    const target = { providerId: 'xd', agent: 'codex', modelId: 'shown' };
    const forged = { dataOwnerId: 'controller', ownerGeneration: 1 };
    const send = (call: string, value?: unknown) =>
      f.channel.handle('controller', {
        op: 'model-call',
        ownerGeneration: 7,
        call,
        target,
        ...(value === undefined ? {} : { value }),
      });
    await expect(send('context-get')).resolves.toMatchObject({
      catalogChanged: false,
      value: { channel: 'maker:model-context-limit:get' },
    });
    await expect(send('context-set', 64_000)).resolves.toMatchObject({ catalogChanged: true });
    await send('compaction-set', null);
    await send('context-reset');
    const quote = { currency: 'USD', inputPerMtok: 1, outputPerMtok: 2 };
    await send('price-set', quote);
    expect(f.call.mock.calls.map(([channel, args]) => [channel, args])).toEqual([
      ['maker:model-context-limit:get', [target]],
      ['maker:model-context-limit:set', [target, 64_000, OWNER]],
      ['maker:model-compaction:set', [target, null, OWNER]],
      ['maker:model-context-limit:reset', [target, OWNER]],
      ['maker:model-price-override:set', [target, quote]],
    ]);
    expect(JSON.stringify(f.call.mock.calls)).not.toContain(forged.dataOwnerId);
    await expect(send('price-set', 3)).rejects.toThrow('[INVALID_PARAMS]');
    await expect(send('context-set', quote)).rejects.toThrow('[INVALID_PARAMS]');
    await expect(
      f.channel.handle('controller', {
        op: 'model-call',
        ownerGeneration: 7,
        call: 'context-set',
        target: { ...target, owner: forged },
        value: 1,
      }),
    ).rejects.toThrow('[INVALID_PARAMS]');
  });

  it('applies reasoning effort on the instance and returns the new effort memory', async () => {
    const f = setup();
    await expect(
      f.channel.handle('controller', {
        op: 'effort',
        ownerGeneration: 7,
        agent: 'codex',
        providerId: 'xd',
        modelId: 'shown',
        effort: null,
      }),
    ).resolves.toEqual({
      ok: true,
      ownerGeneration: 7,
      catalogChanged: false,
      value: { 'codex:*': { shown: 'high' } },
    });
    expect(f.deps.applyEffort).toHaveBeenCalledWith({
      agent: 'codex',
      providerId: 'xd',
      modelId: 'shown',
      effort: null,
    });
    const list = (await f.channel.handle('controller', { op: 'list' })) as { efforts: unknown };
    expect(list.efforts).toEqual({ 'codex:*': { shown: 'high' } });
  });

  it('edits a custom model on the instance and scans the instance CLIs', async () => {
    const f = setup();
    const edit = { kind: 'capability', media: 'image', value: 'edit' } as const;
    await expect(
      f.channel.handle('controller', {
        op: 'model-edit',
        ownerGeneration: 7,
        providerId: 'web-1',
        agent: 'codex',
        modelId: 'm',
        edit,
      }),
    ).resolves.toMatchObject({ catalogChanged: true });
    expect(f.deps.editModel).toHaveBeenCalledWith(
      { providerId: 'web-1', agent: 'codex', modelId: 'm', edit },
      expect.objectContaining({ assertCurrent: expect.any(Function) }),
    );
    f.call.mockResolvedValueOnce({ detections: [] });
    await expect(
      f.channel.handle('controller', { op: 'cli-scan', ownerGeneration: 7 }),
    ).resolves.toMatchObject({ value: { detections: [] } });
    expect(f.call).toHaveBeenLastCalledWith('maker:provider:local-cli-scan', [], expect.anything());
  });

  it('runs only guest share actions on the instance', async () => {
    const f = setup();
    const share = (command: unknown) =>
      f.channel.handle('controller', { op: 'share', ownerGeneration: 7, command });
    await expect(
      share({ action: 'set-credential-consent', shareId: 's1', skip: true }),
    ).resolves.toMatchObject({
      value: { command: { action: 'set-credential-consent', shareId: 's1', skip: true } },
    });
    await share({ action: 'leave', memberId: 'm1' });
    expect(f.deps.shareCommand).toHaveBeenCalledTimes(2);
    for (const forbidden of [
      { action: 'create-link', providerId: 'xd' },
      { action: 'approve', requestId: 'r1' },
      { action: 'send-request', link: 'cindy://provider-share/join?x=1' },
    ])
      await expect(share(forbidden)).rejects.toThrow('[INVALID_PARAMS]');
    expect(f.deps.shareCommand).toHaveBeenCalledTimes(2);
  });
});
