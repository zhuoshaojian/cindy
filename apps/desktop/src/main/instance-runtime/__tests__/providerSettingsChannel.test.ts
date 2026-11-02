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
    ...overrides,
  };
  return {
    channel: createProviderSettingsChannel(deps),
    call,
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
});
