# Upstream 0.1.121 alignment

The cloud feature branch integrates official `v0.1.121`
(`727afb1ad6902176e2ec55254154b900c489a998`, released 2026-10-30) on
[`feat/cloud-settings-native-client`](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client).
Source merge: `3ef0ec1b19`; harness adaptation: `ba70c482cb` (frozen source).
Delivery recipe: `7d49c80809`. Release identity: `0.1.121-cloud.1`.
Neither repository's default branch is changed.

## Compatibility decisions

Upstream added 151 commits (569 files). Eight files conflicted and were resolved
individually; upstream made no change under `deploy/linux-desktop/`.

- `authManager.ts`: upstream stops cold-start recovery at every login-state entry.
  Managed cloud instances still refuse local mode first, so a rejected call has no
  side effect; every other entry already ordered the guard before the stop. Runtime
  `refresh` takes upstream's unused-options signature and keeps the managed-instance
  path.
- `hook-control/ipc.ts`: cloud hook management imports plus the new group image reader.
- `maker-ipc/register.ts`: the execution Host still owns personalization
  (`captureHostPersonalization`); upstream's only change there, a creation-cancellation
  checkpoint, follows it.
- The notification test imports and three documents keep both sides.
- The direct-link runtime source was regenerated from the merged code; it is
  identical to upstream's generated output.

Three tests (`authColdStartRecovery`, `authRefreshBackoff`, `authPostCommitStartup`)
compile selected `authManager` functions with injected globals. The fork's
`initialize`/`refresh` begin with a managed-instance check, so the harnesses now
supply `getInstanceConfig = () => null` and fail if a managed-instance path runs.
The compared function bodies differ from upstream only by that branch.

Upstream migration `0136_bizarre_pet_avengers.sql` is retained unchanged: it adds
the nullable `hook_group_messages.image_refs` column and recreates the three group
message statistics triggers to count it. The migration directory is byte-identical
to `v0.1.121`. Upstream's self-hosted relay deployment, remote-desktop idle lock and
group-history image tool are local features; no CIS settings field was added and the
frozen snapshot leaf count is unchanged.

## Source and package checks

These are macOS checkout checks and disposable fixtures, not real-account or
cross-device acceptance.

| Check | Result |
| --- | --- |
| Frozen dependency installation | Passed (upstream added the relay package) |
| Desktop / Mobile typechecks | Passed |
| maker-shared / maker-core / device-link builds | Passed |
| Conflict, auth, Host, cloud settings and shared suites | 18,206 passed; 28 failed, listed below |
| Desktop DB tier (official preflight) | 2,479 passed; 22 failed, listed below |
| Migration tier / replay | Passed |
| `db:validate` | Steps 1–5 and the fixed baseline passed; see note |
| DeviceLink package | 1,112 passed |
| Settings components, IM, DeviceLink and remote-desktop main | 5,970 passed; 6 failed, listed below |
| Recipe Node tests with CI source variables | 140 passed; 1 local Bash-version skip |
| Recipe, base, delivery and font Python checks | Four commands passed |
| Clean exported-source cloud overlay staging | 30 records passed |
| Cloud settings UI fixture, all cases, both themes | 20/20 |

Failures not caused by this merge:

- 22 local database tests (`sessionAutoTitlePersist`, `remoteHistoryPagination`,
  `DbClient.inproc`, `WorkerThreadTransport`) fail identically in the DB tier. The
  `localDb` tree and dependency lock differ from `v0.1.121` only by an unrelated
  passing fork test, so these are inherited upstream results.
- `settingsSnapshotCoverageRuntime` (5) still reports 459 native leaves against 456,
  unchanged from before the merge.
- `drizzle-proxy-perf` belongs to the host-sensitive performance tier.
- `defaultSessionSettings` (6) times out waiting for the fork's Host-owned model
  visibility mirror. Its resolver chain and test are unchanged by the merge; this is
  an existing fork test gap.

`db:validate` step 6 compares against upstream `origin/main`, which already has seven
later migrations (0137–0143). Following the tag, these are absent rather than
rewritten; 0000–0136 are identical to `main`.

The isolated Mac package is `0.1.121-dev.cloud.20261102.1`, built from `ba70c482cb`.
Its source was cloned from the previous Dev package, patched and verified against all
17,986 tracked blobs (five LFS files by recorded SHA-256), then frozen-installed.
Package inspection passed for arm64, isolated application identity, absence of
production URL handlers and signature continuity. The formal installed client is
unchanged. Successful packaging does not prove startup or cloud saves.

## Delivery

[Delivery run 41388752432](https://github.com/zhuoshaojian/cindy/actions/runs/41388752432)
used the existing fork-only self-hosted workflow and completed in **31 minutes 49 seconds**
(verify 39 s, candidate 23 min 17 s, cache 4 min 31 s, plus queueing). Verify ran the recipe
regressions against the real merged source.

The candidate stage published `cloud-runtime-cn:0.1.121-cloud.1-cn-amd64` and
`sha-7d49c80809a6e4ba972285db2c79cdcf855f7b3c-cn-amd64` to the same manifest:
`sha256:1960f501607350f29385f568b4acd40c3711d217a345798c04202041e4967c0a`
(config `sha256:cccc3182db484e2cacafb8989a6fc8ef5265bb9fac8fe6131935a25a7c2ba5c5`, two layers).
All five build records matched the candidate receipt. SQLite, SQLite vec and PTY passed with
Electron 42.11.12 (ABI 146); the isolated Linux smoke passed with no network, a read-only root,
sandboxed renderers, a working desktop and normal shutdown, reporting the embedded version.

Both ACS cache entries were Ready. A disposable Pod proved an actual cache hit
(`imc-uf6jfp9fd7gd0ttazkpy`) for main and init with the embedded `0.1.121-cloud.1`, then was
removed by UID. CI did not change instance admission or new-claim defaults.

## Owner validation

Owner-only admission added the exact release to the owner profile and the keyring list. At the
16-entry cap it retired the unreferenced `0.1.108-xfce-dock-r5c.20261020` keyring/maintenance
entry and the owner's unused `0.1.108-source-r6.20261020` approval; existing native and
new-claim selections were checked unchanged. Both roles loaded the policy with their deployed
schema, rolled out ready and stable, and confirmed that only the owner may upgrade, other records
and Pods were unchanged and new claims still select `0.1.120-cloud.2`.

The owner upgrade from `0.1.120-cloud.2` went through the maintenance service: stopped,
read-only-PVC encrypted OSS backup of **3,548 files / 726,973,111 bytes**, main and init on the
delivered digest with an actual cache hit, ready with zero restarts, maintenance released, and
databases and schedules preserved. The packaged Xfce desktop and locked Dock started. Migration
0136 is present on the instance: `image_refs` exists and all three statistics triggers count it.

The installed Mac Dev `0.1.121-dev.cloud.20261102.1` started after Keychain access and the
sidebar cloud entry was visible. Through the real Main → CIS → runtime path the owner target
exposed 34 domains: 31 ready and three conditional unavailable results (`wecomNotifications`
without a configured webhook, `telegramGroups`, `chatEmbedding`), with no read failure.
About shows `0.1.121-cloud.1-cn-amd64`, and the WeCom card still shows the native group
webhook section with the target-named hint.

A real UI change disabled cloud system notifications without an error. Closing and reopening
the page read back off, and an independent read of the instance preference file showed
`notificationsEnabled: false`. The original value had no override, so the public save API
(with its read-issued operation ticket) cleared it: the revision returned to its original
value, the reopened UI showed on and the instance file no longer contains the key. The Mac
Dev preference file was byte-for-byte unchanged. This is real client acceptance on the owner
instance, not a DeviceLink transport or third-party OAuth retest. Other instances remain on
`0.1.120-cloud.2` until a separate fleet admission.
