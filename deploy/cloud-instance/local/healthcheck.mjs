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
if (
  !status ||
  status.version !== 1 ||
  status.phase !== 'ready' ||
  !Number.isFinite(status.heartbeatAtMs) ||
  status.heartbeatAtMs > now ||
  now - status.heartbeatAtMs > staleAfterMs ||
  !status.readiness ||
  Object.values(status.readiness).some((value) => value !== 'ready')
) {
  console.error('[cloud-health] runtime status is not ready or stale');
  process.exit(1);
}
console.log('[cloud-health] ready');
