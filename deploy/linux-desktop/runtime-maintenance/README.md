# Cloud maintenance build

This overlay is maintained in the client image sources and applied only when packaging a cloud
runtime. It does not modify the ordinary desktop source or credential migration
v3. Include `runtime-activity/overlay.mjs` before this plugin in the existing
desktop main-process Vite build.

Pass `expectedRegion: 'cn'` or `'global'` explicitly to
`cloudMaintenancePlugin`. The resolved main-process
`import.meta.env.VITE_CINDY_AUTH_REGION` definition must match. Use the existing
desktop build recipe's region configuration for all entries; rebuilding only
main with implicit defaults can produce a region that differs from the preserved
renderer and mounted endpoint manifest. The plugin rejects that build before
packaging. Never patch the deployed endpoint manifest to accommodate a wrongly
built application.

The former on-volume `maintenance-backup.py` helper is retired: do not package
or invoke it. Existing recovery archives are left untouched. Pre-upgrade backups,
when `upgradeBackup` is configured, run from CIS in a separate stopped-volume Pod.
This overlay supplies their precondition: it wires the desktop quit chain
(`lifecycle.ts`) so that a fault-free, orderly quit of a sealed operation writes
`/var/lib/cindy/user-data/.cis-maintenance/shutdown.json`. Roll this image out to
every instance before enabling `upgradeBackup` (see the service document).
Build the dependency base and application from the complete committed Dockerfile
chain and recorded source inputs; do not use an exported old runtime as the base.
Preserve native unpack flags,
preload/worker assets and the release's configured region.

Run the overlay tests against the actual target client checkout using
`CINDY_ACTIVITY_TEST_SOURCE`.
Qualify the packaged artifact in an isolated Linux environment. Synthetic
credential/preflight and `--smoke-test` checks do not exercise normal cloud
startup; the admitted instance must also pass normal startup against its existing
endpoint manifest, canonical account, device identity and sandbox evidence.

The mount qualification, persistent ledger and
explicit single-instance execution contract are documented in
the CIS service contract (`docs/cloud-instance-server.md` in the server repository).
The web API remains a configuration preview until an automatic worker is
separately qualified and enabled.

## Pending schedules during automatic maintenance

The runtime advertises `scheduleAdmission: "running-only"` in its maintenance-v1
receipt. Deploy the corresponding CIS parser first: older CIS rejects this added
receipt field and must not control this image. New CIS retains the legacy wake
headroom rule for old runtimes; it ignores future/past unstarted wake times only
for automatic maintenance-window plans with the new source capability. Manual
upgrade requests keep their existing schedule protection.

Only `scheduler-next-wake` is removed from maintenance activity. The ordinary
idle/suspension reader is unchanged. Running/queued work, active sessions, remote
input, in-flight scheduler scans and unknown observations still prevent sealing.
The scheduler continues during prepare; a racing trigger invalidates quiet and
must finish before seal. Window headroom, leases and stopped-volume backup remain.

On a sealed replacement boot, valid persisted schedules due during downtime retain
their `nextFireAt` instead of startup normalization skipping the pending occurrence.
The original scheduler claims each once after release, then resumes its cadence;
this does not replay every missed interval. Manual, invalid and completed one-shot
schedules stay excluded. Schedules/cron are not deleted or disabled, and no new
accepted-work queue is introduced (`deferredTasks` remains false).

`gate.test.mjs` covers pending wakes, real-work races and maintenance-only sampling.
`overlay.test.mjs` executes the real transformed scheduler with memory storage and
a fake clock through sealed startup, release and two ticks. Both files run under
one second locally; this is simulated runtime integration, not a live cloud upgrade.
