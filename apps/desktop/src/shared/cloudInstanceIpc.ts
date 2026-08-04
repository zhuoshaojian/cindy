/** Provider-neutral resource class selected for a cloud instance. */
export type CloudInstanceResourceTier = 'small' | 'medium' | 'large';

/** Control-plane desired lifecycle state. */
export type CloudInstanceDesiredState = 'running' | 'stopped' | 'deleted';

/** Provider-observed runtime lifecycle state. */
export type CloudInstanceRuntimeState =
  | 'missing'
  | 'creating'
  | 'created'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'restarting'
  | 'deleting'
  | 'error';

/** Readiness reason values shared by renderer IPC and runtime assessment. */
export const CLOUD_INSTANCE_READINESS_REASONS = [
  'unknown',
  'missing-status',
  'corrupt-status',
  'stale-heartbeat',
  'runtime-not-ready',
  'ready',
] as const;

export type CloudInstanceReadinessReason =
  (typeof CLOUD_INSTANCE_READINESS_REASONS)[number];

/** Fail-closed runtime readiness summary returned by the control plane. */
export interface CloudInstanceReadiness {
  ready: boolean;
  reason: CloudInstanceReadinessReason;
  blockers: string[];
}

/** Membership ownership echoed by the authenticated control plane. */
export interface CloudInstanceOwnership {
  passportId: string;
  membershipId: string;
  membershipKind: 'personal' | 'org';
  orgSlug: string | null;
}

/** Runtime status returned by cloud-instance-server. */
export interface CloudInstanceStatus {
  instanceId: string;
  deviceId: string;
  ownership: CloudInstanceOwnership;
  desiredState: CloudInstanceDesiredState;
  nextWakeAtMs: number | null;
  runtimeState: CloudInstanceRuntimeState;
  resourceTier: CloudInstanceResourceTier;
  readiness: CloudInstanceReadiness;
  /** Upgrade lifecycle reported by newer control planes. Missing means idle. */
  upgrade?: {
    state: 'idle' | 'verifying' | 'rolled-back';
    targetImage: string | null;
    previousImage: string | null;
    deadlineAtMs: number | null;
  };
  /** Failed target retained after automatic rollback. Missing means no known failure. */
  lastFailedUpgradeImage?: string | null;
  /** Newer control planes set these release hints; older servers omit both. */
  updateAvailable?: boolean;
  latestReleaseTag?: string | null;
  updatedAtMs: number;
}

/** One membership-owned instance listed by the control plane. */
export interface CloudInstanceView {
  instanceId: string;
  deviceId: string;
  nameSequence: number;
  customLabel: string | null;
  status: CloudInstanceStatus;
}

/** Shared result of wake and explicit create operations. */
export interface CloudInstanceEnableResult extends CloudInstanceView {
  created: boolean;
}

/** Result of setting or clearing a custom instance label. */
export interface CloudInstanceRenameResult {
  instanceId: string;
  deviceId: string;
  nameSequence: number;
  customLabel: string | null;
}

/** Renderer-to-main wake input. Omission preserves zero/one-instance convenience semantics. */
export interface CloudInstanceWakeInput {
  instanceId?: string;
  resourceTier?: CloudInstanceResourceTier;
}

/** Renderer-to-main explicit create input. */
export interface CloudInstanceCreateInput {
  resourceTier?: CloudInstanceResourceTier;
}

/** Renderer-to-main rename/reset input. */
export interface CloudInstanceRenameInput {
  instanceId: string;
  customLabel: string | null;
}

/** Renderer-to-main status lookup input. */
export interface CloudInstanceStatusInput {
  instanceId?: string;
}

/** Renderer-to-main manual sleep input. */
export interface CloudInstanceStopInput {
  instanceId: string;
}

/** Renderer-to-main upgrade input. The server owns the release target. */
export interface CloudInstanceUpgradeInput {
  instanceId: string;
}

/** Result returned after asking the control plane to apply the latest release. */
export interface CloudInstanceUpgradeResult {
  status: CloudInstanceStatus;
  outcome?: 'no-op' | 'upgraded' | 'verifying';
  targetImage?: string;
}

/** Renderer-to-main permanent deletion input. */
export interface CloudInstanceDeleteInput {
  instanceId: string;
}

/** Account credential revocation result returned after permanent deletion. */
export interface CloudInstanceRevocationResult {
  status: 'revoked' | 'failed';
  code?: string;
  message?: string;
}

/** Full cleanup result returned by the control plane after permanent deletion. */
export interface CloudInstanceDeleteResult {
  status: CloudInstanceStatus;
  revocation: CloudInstanceRevocationResult;
  archiveCleanup: 'removed' | 'skipped-online' | 'not-configured' | 'failed';
  archiveCleanupCode?: string;
  archiveCleanupMessage?: string;
}

/** Cloud instance IPC channel registry shared by main and preload. */
export const CLOUD_INSTANCE_INVOKE = {
  LIST: 'cloud-instance:list',
  WAKE: 'cloud-instance:wake',
  CREATE: 'cloud-instance:create',
  RENAME: 'cloud-instance:rename',
  STATUS: 'cloud-instance:status',
  STOP: 'cloud-instance:stop',
  UPGRADE: 'cloud-instance:upgrade',
  DELETE: 'cloud-instance:delete',
} as const;
