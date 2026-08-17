import { describe, expect, it } from 'vitest';

import type { MakerVendor } from '@/lib/ccAgent.types';
import { resolveDraftAgentAvailability } from '../draftAgentAvailability';

const vendors = (...values: MakerVendor[]): ReadonlySet<MakerVendor> => new Set(values);

describe('resolveDraftAgentAvailability', () => {
  it('waits while the authoritative runtime list is loading', () => {
    expect(resolveDraftAgentAvailability('pi', vendors(), 'loading')).toEqual({ kind: 'wait' });
  });

  it('keeps the existing fail-open behavior when the query fails', () => {
    expect(resolveDraftAgentAvailability('pi', vendors(), 'error')).toEqual({ kind: 'proceed' });
  });

  it('allows a selected Agent that the runtime registered', () => {
    expect(resolveDraftAgentAvailability('codex', vendors('codex'), 'ready')).toEqual({
      kind: 'proceed',
    });
  });

  it('switches an unavailable persisted Agent using the shared preference order', () => {
    expect(resolveDraftAgentAvailability('pi', vendors('codex', 'cc'), 'ready')).toEqual({
      kind: 'switch',
      vendor: 'cc',
    });
  });

  it('fails closed when the authoritative result contains no registered Agents', () => {
    expect(resolveDraftAgentAvailability('pi', vendors(), 'ready')).toEqual({
      kind: 'unavailable',
    });
  });

  it('does not gate Orca on maker Agent registration', () => {
    expect(resolveDraftAgentAvailability('orca', vendors(), 'loading')).toEqual({
      kind: 'proceed',
    });
  });
});
