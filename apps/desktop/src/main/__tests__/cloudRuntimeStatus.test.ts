import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOUD_IDLE_BLOCKERS } from '../cloud-runtime/activity.js';
import { evaluateCloudReadiness } from '../cloud-runtime/readiness.js';
import {
  CLOUD_READINESS_VALUES,
  CLOUD_RUNTIME_PHASES,
  createCloudStatusStore,
  type CloudRuntimeStatus,
} from '../cloud-runtime/status.js';
import { CLOUD_INSTANCE_READINESS_REASONS } from '../../shared/cloudInstanceIpc.js';

const dirs: string[] = [];

function status(heartbeatAtMs = 10_000): CloudRuntimeStatus {
  return {
    version: 1,
    instanceId: 'pod-test',
    membershipId: 'membership-test',
    phase: 'ready',
    startedAtMs: 1_000,
    heartbeatAtMs,
    draining: false,
    readiness: {
      auth: 'ready',
      database: 'ready',
      binaries: 'ready',
      maker: 'ready',
      deviceLink: 'ready',
      modelAccess: 'ready',
    },
    idle: {
      maySuspend: false,
      blockers: ['idle-grace'],
      lastBusyAtMs: 9_000,
      nextWakeAtMs: null,
    },
  };
}

function makeStatusFile(options: {
  relativePath?: string;
  tempSuffix?: () => string;
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-cloud-status-'));
  dirs.push(dir);
  const filePath = path.join(dir, options.relativePath ?? 'status.json');
  const store = createCloudStatusStore(
    filePath,
    options.tempSuffix ? { tempSuffix: options.tempSuffix } : {},
  );
  return { filePath, store };
}

function expectSameValues(actual: readonly string[], expected: readonly string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('cloud runtime status', () => {
  it('locks the status contract enum value sets', () => {
    expectSameValues(CLOUD_RUNTIME_PHASES, [
      'starting',
      'ready',
      'degraded',
      'draining',
      'stopping',
    ]);
    expectSameValues(CLOUD_READINESS_VALUES, ['ready', 'not-ready', 'unknown']);
    expectSameValues(CLOUD_IDLE_BLOCKERS, [
      'activity-unknown',
      'activity-stale',
      'runtime-not-ready',
      'active-turn',
      'pending-input',
      'pending-interaction',
      'scheduler-in-flight',
      'scheduler-waiting',
      'scheduler-next-wake',
      'device-link-controller',
      'device-link-subscription',
      'embedding-active',
      'keep-awake',
      'idle-grace',
    ]);
    expectSameValues(CLOUD_INSTANCE_READINESS_REASONS, [
      'unknown',
      'missing-status',
      'corrupt-status',
      'stale-heartbeat',
      'runtime-not-ready',
      'ready',
    ]);
  });

  it('locks the complete status.json writer byte format', async () => {
    const { filePath, store } = makeStatusFile({ tempSuffix: () => 'contract' });
    const document: CloudRuntimeStatus = {
      ...status(2_000),
      phase: 'draining',
      draining: true,
    };

    await store.write(document);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      '{"version":1,"instanceId":"pod-test","membershipId":"membership-test","phase":"draining",'
      + '"startedAtMs":1000,"heartbeatAtMs":2000,"draining":true,'
      + '"readiness":{"auth":"ready","database":"ready","binaries":"ready","maker":"ready",'
      + '"deviceLink":"ready","modelAccess":"ready"},'
      + '"idle":{"maySuspend":false,"blockers":["idle-grace"],"lastBusyAtMs":9000,'
      + '"nextWakeAtMs":null}}\n',
    );
  });

  it('atomically writes and validates a status document', async () => {
    const { filePath, store } = makeStatusFile({
      relativePath: path.join('nested', 'status.json'),
      tempSuffix: () => 'test',
    });
    await store.write(status());
    await expect(store.read()).resolves.toEqual({ kind: 'ok', status: status() });
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(['status.json']);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('reports missing and corrupt state without treating either as ready', async () => {
    const { filePath, store } = makeStatusFile();
    const missing = await store.read();
    expect(missing).toEqual({ kind: 'missing' });
    expect(evaluateCloudReadiness(missing, { nowMs: 10_000, staleAfterMs: 1_000 })).toMatchObject({
      ready: false,
      reason: 'missing-status',
    });

    fs.writeFileSync(filePath, '{broken', 'utf8');
    const corrupt = await store.read();
    expect(corrupt).toMatchObject({ kind: 'corrupt' });
    expect(evaluateCloudReadiness(corrupt, { nowMs: 10_000, staleAfterMs: 1_000 })).toMatchObject({
      ready: false,
      reason: 'corrupt-status',
    });
  });

  it('rejects stale heartbeats and incomplete readiness', () => {
    expect(
      evaluateCloudReadiness(
        { kind: 'ok', status: status(5_000) },
        { nowMs: 10_001, staleAfterMs: 5_000 },
      ),
    ).toMatchObject({ ready: false, reason: 'stale-heartbeat' });

    const notReady = status();
    notReady.readiness.maker = 'unknown';
    expect(
      evaluateCloudReadiness(
        { kind: 'ok', status: notReady },
        { nowMs: 10_001, staleAfterMs: 5_000 },
      ),
    ).toEqual({
      ready: false,
      reason: 'runtime-not-ready',
      notReadyComponents: ['maker'],
    });
  });

  it('treats modelAccess as observation-only and defaults old documents to unknown', async () => {
    const observed = status();
    observed.readiness.modelAccess = 'not-ready';
    expect(
      evaluateCloudReadiness(
        { kind: 'ok', status: observed },
        { nowMs: 10_001, staleAfterMs: 5_000 },
      ),
    ).toEqual({ ready: true, reason: 'ready', notReadyComponents: [] });

    const { filePath, store } = makeStatusFile();
    const legacy = status();
    const raw = JSON.parse(JSON.stringify(legacy)) as {
      readiness: Record<string, unknown>;
    };
    delete raw.readiness.modelAccess;
    fs.writeFileSync(filePath, JSON.stringify(raw), 'utf8');
    await expect(store.read()).resolves.toMatchObject({
      kind: 'ok',
      status: { readiness: { modelAccess: 'unknown' } },
    });
  });
});
