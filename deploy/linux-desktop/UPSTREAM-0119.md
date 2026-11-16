# Upstream 0.1.119 alignment

The cloud fork integrates official `v0.1.119`
(`0694ed7e001e027a031ffed21a088bd1975132de`) on
[`feat/cloud-settings-native-client`](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client).
Neither repository's default branch is changed. Release identity is
`0.1.119-cloud.2`; source delivery and owner-only acceptance passed before wider admission.

## Compatibility decisions

- Resolve 38 conflicted files individually, retaining cloud permission refresh,
  account isolation, independent login windows, managed identity restrictions,
  Host-owned preferences, native desktop input and per-device recovery.
- Persist cross-engine thinking selections through the owner-fenced Host writer
  before bootstrap, without relying on a renderer acknowledgment.
- Add upstream terminal appearance fields to the local persistence validator;
  explicit resets clear overrides. The deployed CIS snapshot field set is unchanged.
- Preserve upstream business-ownership prompts and turn descriptions while adapting
  cloud overlay anchors. Missing or duplicate anchors still fail the build.
- Regenerate remote viewer and direct-link embedded sources from the merged code.
- Retain all upstream SQLite migrations; validate both the immutable history and
  replay in disposable databases before touching the owner instance.

## Local verification (2026-10-29)

These are macOS checkout tests with disposable fixtures, not real OAuth or
DeviceLink end-to-end acceptance.

| Check | Result |
| --- | --- |
| Frozen dependency install | Passed |
| Desktop and Mobile typechecks | Passed |
| maker-shared, maker-core, MCP and device-link TypeScript builds | Passed |
| Login, Host preferences, model picker and merged-settings tests | 1,488 passed; 2 native-only cases skipped |
| Cloud settings, authorization and remote desktop | 1,249 passed; 6 environment-specific cases skipped |
| maker-shared | 1,949 passed |
| Pi skill selection | 14 passed |
| Database validation / migration replay | Passed / 20 passed |
| Cloud recipe Node tests | 135 passed; Bash-version-dependent test skipped locally |
| Full cloud overlay staging | Passed; 29 records |
| Changed UI variants, both themes | 436 covered by the initial run and per-page reruns; mixed Electron / Chromium fixtures |

The first all-page Electron run stopped after native video-menu timeouts.
Per-page reruns passed: Chromium for affected model/organization/provider pages
and video menus, Electron for all 24 mail-preview variants. These prove fixture
interactions, not macOS native fullscreen transitions or real-account login.
After Keychain authorization, the full isolated Mac developer client reached its
main window. The actual renderer showed the cloud sidebar entry and opened the
owner's cloud settings: running state, `0.1.115-cloud.1` before admission, automatic
updates and the configured maintenance window matched CIS. Verification used the
existing development-only CDP endpoint because native screenshots/accessibility
results were stale. This is actual client UI evidence, not DeviceLink transport
acceptance; the official installed client was not restarted or replaced.

The first delivery (`cloud.1`, run
[40732826735](https://github.com/zhuoshaojian/cindy/actions/runs/40732826735))
stopped at production bundling: Node exhausted the old 6 GiB heap limit. It did
not publish an image or change any instance. `cloud.2` raises only the packaging
process limit to 12 GiB inside the existing 28 GiB build container; dependency
preparation and runtime resource limits are unchanged.

## Source delivery and cache verification

[Run 40736391179](https://github.com/zhuoshaojian/cindy/actions/runs/40736391179)
completed successfully from recipe commit
`a576b26a4023c985a59bc3154c35747de0cf6aec`. The frozen application source is
`f3b167c0bf9b6c2ae7baa8d7c9a40419fb2aacc2`. Total workflow elapsed time, including
job provisioning and queues, was **17 minutes 01 second**; the candidate job took
8 minutes 51 seconds and cache job 5 minutes. Dependency, native-module and Dock
build caches were reused. The successful full-build step took 6 minutes 40 seconds.

- Published tag: `cloud-runtime-cn:0.1.119-cloud.2-cn-amd64`.
- Manifest digest: `sha256:31ed2d3d03e8c7d688f8d66f89706a107ab9d13ec5b8f31a7b8eaa73494cda1a`.
- Native SQLite, SQLite vec and PTY checks passed against the final package.
- Isolated Linux smoke passed with a read-only root, legacy HOME permissions,
  sandboxed renderers, working desktop, hidden Dock preferences and clean shutdown.
- ACS reported both required caches Ready. A separate disposable Pod subsequently
  proved an actual cache hit for the new image as both main and init container,
  with zero restarts, successful exits and embedded version `0.1.119-cloud.2`.
- Owner-only admission was applied first. The actual Mac client then showed the
  new target and enabled its upgrade button after refresh completed; other
  instances and new-claim selection remained on their previous admission rules.

## Owner instance acceptance

The deployed CIS maintenance service requested the owner-only upgrade from
`0.1.115-cloud.1` to `0.1.119-cloud.2`. This used the normal maintenance and backup
path, not a direct StatefulSet image patch. The native-client version notification
and progress display were checked separately; this run did not click its upgrade
button to submit the request.

- All activity counters were zero before the request. The source shut down and
  encrypted OSS backup completed: **3,395 files / 442,321,556 ciphertext bytes**.
- The operation completed its existing health observation and released maintenance.
  The new Pod was Ready with zero restarts. Main and init used the exact published
  image and actually matched its ACS cache.
- PVC, owner/device identity, resources, automatic-update preference and maintenance
  policy were preserved. All three databases passed integrity checks; session and
  message counts and existing schedule rows matched the pre-upgrade evidence.
  New schedule location columns were present with null values. No new crash dumps
  appeared. Changed JSON metadata was limited to audit timestamps, projection
  transition IDs/timestamps and the migration ledger; projection owner was unchanged.
- Xfce, Plank, system terminal/Chrome launchers and locked Dock items passed. Dock
  preferences remained disabled. Actual cloud native input passed for Chinese,
  Emoji and backspace in terminal and personal Chrome, plus terminal Return,
  minimize/restore and Chrome fullscreen geometry. Test windows were closed.
- The cloud app's embedded version and ASAR hash matched the delivered image. Its
  actual framebuffer showed the usable main window and `0.1.119-cloud.2`. The Mac
  developer client showed running state, the same version and upgrade completion.

These are real owner-instance and client-UI checks. They do **not** repeat real
third-party OAuth, mobile-device or cross-device DeviceLink end-to-end acceptance.
The Linux input test exercises the packaged native helper directly.

## Admission after owner acceptance

Both deployed CIS roles now select the same qualified release. The other **10
running instances** report `updateAvailable=true` and `manualUpgrade=true`.
Their actual images, Pod UIDs, identities, resources, schedules and update policies
were not changed by this admission operation. Existing automatic upgrades continue
under their maintenance windows and real-activity guards. The one stopped
organization instance remains stopped with automatic updates off; it has no
maintenance enrollment and therefore no manual upgrade entry.

New-claim resolution now selects `0.1.119-cloud.2`. The deployed provider's manifest
builder was checked without creating an instance: both main and init use the same
exact published image. No personal-account entitlement was added. There were no
active maintenance operations at the final check.

The automation proposal is [UPSTREAM-ALIGNMENT.md](UPSTREAM-ALIGNMENT.md).
