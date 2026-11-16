# Upstream 0.1.115 alignment

The cloud client fork now contains the complete official `v0.1.115` release
(`6e12261af3121a1fc8f56a23481f3b99bb32787c`), merged into
[`feat/cloud-settings-native-client`](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client).
The upstream repository's default branch is unchanged.

## Compatibility decisions

- Keep the fork's Host-owned, account-scoped model preferences and favorites.
  Support upstream's `ultrafast` value in durable history, remote preferences and
  favorite identity; do not collapse it into ordinary Fast.
- Carry `taskProviderId` through the remote preference writer. Changing a model
  inside an existing task must not move the new-task default to another source.
- Preserve cloud permission refresh after account switching, nonmodal login
  windows, managed-instance identity restrictions, native remote input and relay
  recovery, and the isolated Dev application's identities and storage.
- Keep the deployed CIS snapshot schema. Its boolean Fast fields describe whether
  Fast is enabled; exact tier selection belongs to the newer native protocol.
  A legacy cloud favorites round-trip retains an existing enabled ultrafast tier.
- Regenerate the inline remote viewer from the merged source instead of selecting
  either side's generated bundle. Keep upstream's new protocol compatibility notes.

## Local checks (2026-10-28)

Run against the merged checkout on macOS; test credentials and databases are
fixtures. These results do not claim real OAuth or DeviceLink end-to-end acceptance.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed, lockfile unchanged |
| Desktop typecheck; maker-shared and device-link `build` (`tsc --noEmit`) | Passed |
| Cloud settings, authorization, Host preference and conflict-area regressions | 1,312 passed; 2 native-only tests skipped |
| Main IPC, remote desktop, Dev isolation, renderer preference and migration replay | 8,098 passed; 6 environment-specific tests skipped |
| maker-shared | 1,797 passed |
| device-link | 1,024 passed |
| Additional legacy Fast wire/round-trip tests | 36 passed, including 2 new cases |
| Cloud overlay/source tests with all source environment variables set | 121 passed; 1 Bash-version-dependent test skipped |
| Source build Python tests / delivery Python tests | 32 / 57 passed |
| Committed-source export and full overlay staging | Passed; 29 staged records, no old single-file patch |

Two additional quality checks are **not green**: targeted ESLint reports
25 diagnostics already present in the fork/upstream parents; test-hygiene reports
15 rule/file violations already present in `9f69d4ee7d`. Rechecking the previous
source with the current scanners found no new violations from this merge. These
remain debt before an upstream PR; no baseline, lint rule or test gate was
relaxed. The 15 database migration replay cases passed using disposable test
databases; no user database was opened for these local migration tests.

## Delivery boundary

The cloud release identity is selected by `delivery/version.json` and
`source-freeze.json`. Advancing from 0.1.113 resets the cloud revision to
`0.1.115-cloud.1`; the application version, image labels and delivery record must
agree. The new freeze contains the earlier input-overload fix directly, so no
single-file replacement from an older source tree is required.

A source merge or successful CI image build does not by itself qualify an
instance. Delivery publishes the image and prepares ACS caches. The authorized
rollout first admits only the owner's instance, takes its encrypted OSS backup,
and validates the upgrade. Admission for other instances and new-claim defaults
remains unchanged until that canary passes. This does not force other instances
to restart or change their automatic-update preferences.

## Fork delivery

- Source merge: [`fafa00dcd7`](https://github.com/zhuoshaojian/cindy/commit/fafa00dcd7ab359a39f497f6d73ea10a41cd3746).
- Frozen recipe/version: [`176f2c5234`](https://github.com/zhuoshaojian/cindy/commit/176f2c5234f02207f3b79ccbc21d3e5286950714).
- [Fork delivery run 40679921953](https://github.com/zhuoshaojian/cindy/actions/runs/40679921953), triggered by the branch push and using only dedicated fork runners; all three
  jobs passed (verify, image build/publish, ACS cache).

## Delivered image

- Application version: `0.1.115-cloud.1`; image tag: `0.1.115-cloud.1-cn-amd64`.
- Registry manifest: `sha256:748348d07c0fa31774f06cd62e8d0ee19407b9e6e8d0cc521842b392d15962ca`.
- Two filesystem layers, 3,551,498,576 uncompressed bytes.
- CI native Linux acceptance passed: read-only root, sandboxed renderers,
  root-owned legacy HOME, hidden Dock preferences, ready desktop and clean stop.
- The application version, ASAR audit, native SQLite/vector/PTY modules and
  registry digest are bound by the uploaded candidate artifact.
- Both upgraded init paths and the main image subsequently passed an actual
  ACS cache-hit probe with disposable volumes; no user PVC was mounted.
- End-to-end delivery took 26m 37s (11:26:04–11:52:41 UTC on 2026-10-28),
  including runner supply and ACS cache. This upstream change altered the
  dependency lock and rebuilt the prepared application dependencies; this is
  not evidence that a fully warm build meets the previous 20-minute target.

## Owner canary and admission (2026-10-28)

The owner-only upgrade completed at 12:03:59 UTC, before wider admission. It used
the deployed CIS user-request maintenance path, including its normal health
completion checks, rather than a direct image patch. No client button-click
acceptance is claimed by this operation.

- Before maintenance, active, queued, deferred, in-flight and unknown work were
  all zero. CIS sealed and stopped the source before the read-only PVC backup.
- OSS backup completed: 3,298 files, 439,801,214 encrypted bytes.
- Both the main container and actual initContainer use the delivered digest and
  matched the prepared ACS cache. The new Pod is Ready with zero restarts; CIS
  finished the operation and released maintenance.
- The same PVC, device/account identity, resource configuration and automatic
  update preference were retained. All three databases pass integrity checks;
  existing session/message counts and schedule hashes match the source. No new
  crash dump was created. Startup audit/boundary files refreshed normally; skill
  projection is stable, its quarantine is released and its owner is unchanged.
- Authentication, database, runtime binaries, Maker and DeviceLink readiness
  checks pass. The actual desktop displays `CN · 0.1.115-cloud.1 Beta`.
- Xfce, the 40px Matte Dock, clock, Terminal and personal Chrome are present. Dock
  items remain locked and its preferences action remains disabled.
- On the real cloud desktop, the packaged X11 input helper successfully entered
  Chinese and Emoji into Terminal and personal Chrome, including backspace and
  Enter where applicable. Both minimize/restore checks passed; Chrome fullscreen
  geometry matched the display. Test windows and temporary files were removed.

After that acceptance passed, both CIS roles admitted the exact digest for the
other instances and new claims. The other ten running enterprise instances
report an available manual upgrade; their images and Pod UIDs were unchanged
during this rollout. The stopped enterprise instance remains stopped. New-claim
resolution and the real manifest builder select this version for both main and
init containers; the manifest test did not create an extra instance. Automatic
upgrades retain each instance's existing preference and maintenance policy.

This run adds real cloud upgrade and native Linux desktop evidence. It does not
repeat real third-party OAuth, phone acceptance, or DeviceLink cross-device
video/input/clipboard end-to-end tests. The source-level and protocol regressions
above are recorded separately and do not substitute for those tests.
