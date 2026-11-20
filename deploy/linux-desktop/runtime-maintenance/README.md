# Cloud maintenance gate

Cloud packaging overlay that lets CIS run single-instance maintenance operations
(prepare, seal, cancel, release) against a running instance. Ordinary desktop
builds do not use it.

## Build wiring

`overlay.mjs` routes every work ingress through the gate: agent input, agent
dispatch, scheduler, remote input (including managed login recovery) and plugin
work. It also wires the desktop quit chain (`lifecycle.ts`) and activity sampling
(`bootstrap-electron.ts`). Sampling reads `readMaintenanceActivity` from the
`runtime-activity` virtual module, so that overlay must be applied too.
`stage-cloud-overlays.mjs` applies both to the build's source export and generates
the virtual module from `cloudMaintenancePlugin`. Missing, duplicate or drifted
anchors fail the build.

`cloudMaintenancePlugin` requires an explicit `expectedRegion` (`'cn'` or
`'global'`) that matches the main-process `import.meta.env.VITE_CINDY_AUTH_REGION`;
a mismatch fails before packaging. The current build passes `'cn'`. Never patch a
deployed endpoint manifest to fit a wrongly built application.

## Runtime behavior

The gate is installed only on Linux with `--cloud-instance` and the
`/run/cindy-maintenance` projection (`binding.json`, `command.json`). If the ledger
exists but the projection is missing, startup fails.

- Commands are bound to the instance, device, StatefulSet, PVC, Pod and boot. The
  ledger `/var/lib/cindy/user-data/.cis-maintenance/ledger.json` is written
  atomically with fsync. A corrupt ledger, or a missing one while a command is
  projected, keeps admission closed.
- During prepare, new requests get a retryable `CLOUD_MAINTENANCE_RETRY`
  rejection; already admitted work finishes. No accepted-work queue exists
  (`deferredTasks: false`).
- Seal requires a fresh activity sample (at most 15 s old), nothing in flight, no
  active, queued or unknown work, and 10 s of quiet.
- The receipt is written every 2 s to `/var/lib/cindy/status/maintenance.json`.
- An orderly quit (`before-quit` or SIGTERM) of a sealed operation, with every quit
  step finished in time without error, writes clean-shutdown evidence to
  `/var/lib/cindy/user-data/.cis-maintenance/shutdown.json`. A crash, SIGKILL or
  failed step leaves none, and the stopped-volume backup then refuses the volume.
  CIS runs that backup in a separate Pod; this overlay only supplies the evidence.

## Pending schedules

The receipt advertises `scheduleAdmission: "running-only"`; the controlling CIS
must accept this field. Only `scheduler-next-wake` is excluded from maintenance
activity. Running/queued work, active sessions, remote input, in-flight scheduler
scans and unknown observations still prevent sealing. The ordinary idle/suspension
reader is unchanged. The scheduler continues during prepare; a racing trigger
invalidates quiet and must finish before seal.

On a sealed replacement boot, valid persisted schedules due during downtime retain
their `nextFireAt` instead of startup normalization skipping the pending occurrence.
The scheduler claims each once after release, then resumes its cadence; missed
intervals are not replayed. Manual, invalid and completed one-shot schedules stay
excluded. Schedules/cron are not deleted or disabled.

## Tests

```sh
CINDY_ACTIVITY_TEST_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-maintenance/*.test.mjs
```

`gate.test.mjs` covers admission, seal races, ledger handling, shutdown evidence and
pending wakes. `overlay.test.mjs` checks every ingress and, with a client source,
runs the transformed scheduler with memory storage and a fake clock through sealed
startup, release and two ticks. These are simulated; a packaged image still needs
qualification in an isolated Linux environment with normal cloud startup.
