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

/** Fail-closed runtime readiness summary returned by the control plane. */
export interface CloudInstanceReadiness {
  ready: boolean;
  reason:
    | 'unknown'
    | 'missing-status'
    | 'corrupt-status'
    | 'stale-heartbeat'
    | 'runtime-not-ready'
    | 'ready';
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
  DELETE: 'cloud-instance:delete',
} as const;
