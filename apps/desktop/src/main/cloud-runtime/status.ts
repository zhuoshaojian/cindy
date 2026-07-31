import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { CLOUD_IDLE_BLOCKERS } from './activity.js';

export const CLOUD_READINESS_VALUES = ['ready', 'not-ready', 'unknown'] as const;
export const CLOUD_RUNTIME_PHASES = [
  'starting',
  'ready',
  'degraded',
  'draining',
  'stopping',
] as const;

const readinessValueSchema = z.enum(CLOUD_READINESS_VALUES);

/**
 * Runtime components that define Pod liveness/readiness. Model access is
 * intentionally excluded: it is an operational observation because personal
 * accounts, disabled deployments, and manual-key fallback can all be healthy
 * without server-managed model credentials.
 */
export const CLOUD_BLOCKING_READINESS_COMPONENTS = [
  'auth',
  'database',
  'binaries',
  'maker',
  'deviceLink',
] as const;

export type CloudBlockingReadinessComponent =
  (typeof CLOUD_BLOCKING_READINESS_COMPONENTS)[number];

export const cloudReadinessComponentsSchema = z.object({
  auth: readinessValueSchema,
  database: readinessValueSchema,
  binaries: readinessValueSchema,
  maker: readinessValueSchema,
  deviceLink: readinessValueSchema,
  // Observation-only. Default preserves compatibility with status documents
  // written just before this field was introduced.
  modelAccess: readinessValueSchema.default('unknown'),
});

export type CloudReadinessComponents = z.infer<typeof cloudReadinessComponentsSchema>;

export const cloudRuntimeStatusSchema = z.object({
  version: z.literal(1),
  instanceId: z.string().min(1).max(128),
  membershipId: z.string().min(1).max(128),
  phase: z.enum(CLOUD_RUNTIME_PHASES),
  startedAtMs: z.number().int().nonnegative(),
  heartbeatAtMs: z.number().int().nonnegative(),
  draining: z.boolean(),
  readiness: cloudReadinessComponentsSchema,
  idle: z.object({
    maySuspend: z.boolean(),
    blockers: z.array(z.enum(CLOUD_IDLE_BLOCKERS)),
    lastBusyAtMs: z.number().int().nonnegative(),
    nextWakeAtMs: z.number().int().nonnegative().nullable(),
  }),
});

export type CloudRuntimeStatus = z.infer<typeof cloudRuntimeStatusSchema>;

export type CloudStatusReadResult =
  | { kind: 'ok'; status: CloudRuntimeStatus }
  | { kind: 'missing' }
  | { kind: 'corrupt'; error: string };

export interface CloudStatusFileSystem {
  mkdir(dirPath: string, options: { recursive: true }): Promise<unknown>;
  readFile(filePath: string, encoding: 'utf8'): Promise<string>;
  writeFile(
    filePath: string,
    data: string,
    options: { encoding: 'utf8'; mode: number },
  ): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
}

const nodeStatusFs: CloudStatusFileSystem = {
  mkdir: (dirPath, options) => nodeFs.mkdir(dirPath, options),
  readFile: (filePath, encoding) => nodeFs.readFile(filePath, encoding),
  writeFile: (filePath, data, options) => nodeFs.writeFile(filePath, data, options),
  rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
  unlink: (filePath) => nodeFs.unlink(filePath),
};

export interface CloudStatusStore {
  read(): Promise<CloudStatusReadResult>;
  write(status: CloudRuntimeStatus): Promise<void>;
}

/**
 * JSON status store with same-directory temp + rename semantics. Status never
 * contains credentials and is written owner-readable for container probes.
 */
export function createCloudStatusStore(
  filePath: string,
  options: {
    fs?: CloudStatusFileSystem;
    tempSuffix?: () => string;
  } = {},
): CloudStatusStore {
  const fs = options.fs ?? nodeStatusFs;
  const tempSuffix = options.tempSuffix ?? (() => `${process.pid}-${Date.now()}`);

  return {
    async read(): Promise<CloudStatusReadResult> {
      let raw: string;
      try {
        raw = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === 'ENOENT'
          ? { kind: 'missing' }
          : { kind: 'corrupt', error: `status read failed: ${code ?? 'unknown'}` };
      }
      try {
        const parsed = cloudRuntimeStatusSchema.safeParse(JSON.parse(raw));
        return parsed.success
          ? { kind: 'ok', status: parsed.data }
          : { kind: 'corrupt', error: 'status schema validation failed' };
      } catch {
        return { kind: 'corrupt', error: 'status JSON parse failed' };
      }
    },

    async write(status: CloudRuntimeStatus): Promise<void> {
      const validated = cloudRuntimeStatusSchema.parse(status);
      const dirPath = path.dirname(filePath);
      const tempPath = path.join(dirPath, `.${path.basename(filePath)}.${tempSuffix()}.tmp`);
      await fs.mkdir(dirPath, { recursive: true });
      try {
        await fs.writeFile(tempPath, `${JSON.stringify(validated)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        await fs.rename(tempPath, filePath);
      } catch (error) {
        try {
          await fs.unlink(tempPath);
        } catch {
          // Best-effort cleanup; preserve the original write failure.
        }
        throw error;
      }
    },
  };
}
