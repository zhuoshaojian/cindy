import type { InstalledGhost } from '../../shared/ghost.js';

export interface HostLoginInput {
  sessionId: string;
  reauthorize?: boolean;
  signal?: AbortSignal;
  assertCurrent(): void;
}
export interface HostLoginAdapter {
  id: string;
  supports(ghost: InstalledGhost): boolean;
  connect(ghost: InstalledGhost, input: HostLoginInput): Promise<Record<string, unknown>>;
}

/** Compiled Host integrations only. No dynamic commands or plugin-provided adapter modules. */
export class HostLoginAdapters {
  private readonly entries: readonly HostLoginAdapter[];
  constructor(entries: readonly HostLoginAdapter[]) {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      throw new Error('DUPLICATE_LOGIN_ADAPTER');
    this.entries = entries.map((entry) => Object.freeze({ ...entry }));
  }
  async connect(
    ghost: InstalledGhost,
    input: HostLoginInput,
  ): Promise<Record<string, unknown> | null> {
    input.assertCurrent();
    if (input.signal?.aborted) throw new Error('AUTH_FAILED');
    const matches = this.entries.filter((entry) => entry.supports(ghost));
    if (matches.length > 1) throw new Error('AMBIGUOUS_LOGIN_ADAPTER');
    if (matches.length === 0) return null;
    // A selected adapter failing never falls through into another credential source.
    const result = await matches[0].connect(ghost, input);
    input.assertCurrent();
    if (input.signal?.aborted) throw new Error('AUTH_FAILED');
    return result;
  }
}
