#!/usr/bin/env node
import fs from 'node:fs';

const filePath = process.env.CINDY_CLOUD_STATUS_FILE ?? '/var/lib/cindy/status/status.json';
const staleAfterMs = Number(process.env.CINDY_CLOUD_STATUS_STALE_AFTER_MS ?? 30_000);
let status;
try {
  status = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch {
  console.error('[cloud-health] status file missing or corrupt');
  process.exit(1);
}
const now = Date.now();
// modelAccess is observation-only. Keep the health gate fixed to the original
// five runtime components so disabled/manual-fallback model access remains a
// healthy Pod.
const blockingReadinessComponents = ['auth', 'database', 'binaries', 'maker', 'deviceLink'];
if (
  !status ||
  status.version !== 1 ||
  status.phase !== 'ready' ||
  !Number.isFinite(status.heartbeatAtMs) ||
  status.heartbeatAtMs > now ||
  now - status.heartbeatAtMs > staleAfterMs ||
  !status.readiness ||
  blockingReadinessComponents.some((component) => status.readiness[component] !== 'ready')
) {
  console.error('[cloud-health] runtime status is not ready or stale');
  process.exit(1);
}
console.log('[cloud-health] ready');
