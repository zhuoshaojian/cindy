import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateCloudReadiness } from '../cloud-runtime/readiness.js';
import { createCloudStatusStore, type CloudRuntimeStatus } from '../cloud-runtime/status.js';

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

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('cloud runtime status', () => {
  it('atomically writes and validates a status document', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-cloud-status-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'nested', 'status.json');
    const store = createCloudStatusStore(filePath, { tempSuffix: () => 'test' });
    await store.write(status());
    await expect(store.read()).resolves.toEqual({ kind: 'ok', status: status() });
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(['status.json']);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('reports missing and corrupt state without treating either as ready', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-cloud-status-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'status.json');
    const store = createCloudStatusStore(filePath);
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

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-cloud-status-'));
    dirs.push(dir);
    const filePath = path.join(dir, 'status.json');
    const legacy = status();
    const raw = JSON.parse(JSON.stringify(legacy)) as {
      readiness: Record<string, unknown>;
    };
    delete raw.readiness.modelAccess;
    fs.writeFileSync(filePath, JSON.stringify(raw), 'utf8');
    const store = createCloudStatusStore(filePath);
    await expect(store.read()).resolves.toMatchObject({
      kind: 'ok',
      status: { readiness: { modelAccess: 'unknown' } },
    });
  });
});
