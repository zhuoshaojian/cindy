import type { AvailableAgentsStatus } from '@/hooks/useAvailableAgents';
import type { MakerVendor } from '@/lib/ccAgent.types';

export type DraftAgentAvailabilityDecision =
  | { kind: 'proceed' }
  | { kind: 'wait' }
  | { kind: 'switch'; vendor: Exclude<MakerVendor, 'orca'> }
  | { kind: 'unavailable' };

const FALLBACK_ORDER = ['cc', 'codex', 'pi'] as const;

/**
 * Resolve the creation-time Agent gate from the runtime registration result.
 *
 * `orca` is intentionally outside maker:list-available-agents and therefore must not be
 * gated by that result. A query error keeps the existing fail-open behavior so main's
 * requireAgent remains the final authority; an authoritative ready result fails closed.
 */
export function resolveDraftAgentAvailability(
  selected: MakerVendor,
  available: ReadonlySet<MakerVendor>,
  status: AvailableAgentsStatus,
): DraftAgentAvailabilityDecision {
  if (selected === 'orca') return { kind: 'proceed' };
  if (status === 'loading') return { kind: 'wait' };
  if (status === 'error' || available.has(selected)) return { kind: 'proceed' };

  const fallback = FALLBACK_ORDER.find((vendor) => available.has(vendor));
  return fallback ? { kind: 'switch', vendor: fallback } : { kind: 'unavailable' };
}
