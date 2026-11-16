# Upstream 0.1.120 alignment

The cloud feature branch integrates official `v0.1.120`
(`b0c217c98b2346bb32a34821241992ba52918a86`) on
[`feat/cloud-settings-native-client`](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client).
Source merge: `849316f4ab9ddb89d93ab00fcd88ea83e66ea8dc`.
Delivery recipe: `c4e86172d1949bbf7e3670dad4532c9fda7a277e`.
Release identity: `0.1.120-cloud.1`. Neither repository's default branch is changed.

## Compatibility decisions

Ten conflicted files were resolved individually. The merge preserves cloud
permission refresh, per-account isolation, independent login windows, managed
cloud identity restrictions, Host-owned preference writes and native remote input.
It also retains upstream per-session notification muting, shortcut validation,
transient model selections, recording preview routing and session resume options.
The direct-link embedded source was regenerated from the merged implementation.

Settings continue to share local presentation components with the cloud adapter.
The deployed CIS v2 snapshot field set is unchanged. The three new upstream
shortcuts are classified in the local catalog only; the region-screenshot
shortcut remains limited to macOS/Windows. Local application authorization and
new voice conversation selections/playback are not presented as implemented
remote settings. The explicit gaps are listed in
[the settings parity inventory](../../docs/cloud-settings-parity.md).

The upstream `0135_tranquil_triton.sql` migration is retained unchanged. It adds
`sessions.notifications_muted` with a false default. Existing migration history,
metadata alignment and disposable-database replay passed. The new column is
additive; the owner upgrade still requires a complete stopped, encrypted OSS
backup and checks existing table counts and schedule definitions before release.

## Source and package checks

These are macOS checkout checks and disposable fixtures, not real-account or
cross-device acceptance.

| Check | Result |
| --- | --- |
| Frozen dependency installation | Passed |
| Desktop / Mobile typechecks | Passed |
| maker-shared / maker-core / device-link TypeScript builds | Passed |
| Conflict-focused regression | 1,288 passed after the async Host-write fixture was corrected |
| Cloud settings and Host checks | 1,132 passed after targeted reruns; 2 skipped |
| Catalog and frozen snapshot checks | 145 passed after catalog corrections |
| DeviceLink tests | 1,073 passed |
| Database validation / migration replay | Passed / 21 passed |
| Recipe Node tests | 140 passed; 1 local Bash-version-dependent skip |
| Recipe, base, delivery and font Python checks | Four commands passed |
| Clean exported-source cloud overlay staging | 30 records passed |
| Changed UI fixture variants, both themes | 1,072 covered after isolated reruns |

Counts above describe the targeted suites and may overlap; they are not a unique
total. Initial failures are retained in private evidence. Imported tests now wait
for the existing asynchronous Host writer, and the invalid-permission fixture
uses a genuinely invalid value after upstream added the previous value.

The initial Electron matrix passed 862 variants. Native video/capture menu
timeouts subsequently left the shared fixture window at an incorrect size;
page-isolated Chromium reruns covered the affected variants. The imported speech
visibility fixture also needed the fork's Host preference API and owner/revision
receipts; the original visibility assertions remain unchanged and now pass.
This is mixed Electron/Chromium fixture evidence, not native OS menu/fullscreen
acceptance. Files reported `UNCOVERED` remain outside this fixture result.

The isolated Mac package is `0.1.120-dev.cloud.20261030.1`, built from the source
merge with its own frozen dependency installation. Its existing Dev bundle ID,
profile and fixed signing identity are preserved. The formal installed client
is unchanged. Package inspection passed for arm64, isolated application identity,
absence of production URL handlers and signature continuity. Live acceptance is
recorded separately; successful packaging does not prove startup or cloud saves.

## Delivery and live acceptance

[Delivery run 41015774347](https://github.com/zhuoshaojian/cindy/actions/runs/41015774347)
uses the existing fork-only self-hosted workflow. The two complete Dockerfiles,
pinned upstream/source inputs, native package checks, isolated Linux smoke and
ACS cache receipts remain required. CI does not change instance admission or
new-claim defaults.

The candidate stage published `cloud-runtime-cn:0.1.120-cloud.1-cn-amd64` and
`sha-c4e86172d1949bbf7e3670dad4532c9fda7a277e-cn-amd64` to the same manifest:
`sha256:08397b8890fc26662425ce2188db7156dbf12582e5aa5d1e117208698a639fe5`.
The tested image config is
`sha256:4af84d28bdb71042e41d5a485e183447a1dc34b5792e728a060922cccf9714d3`.
The runtime has two layers and a reported unpacked size of 3,567,705,149 bytes.

All five build record hashes were verified against the candidate manifest.
The final package passed SQLite, SQLite vec and PTY checks with Electron 42.11.12
(ABI 146). Isolated Linux smoke passed with no network, a read-only root,
root-owned legacy HOME directories, sandboxed renderers, a working desktop,
hidden Dock preferences and normal shutdown. It reported the exact delivered
image config and embedded application version.

The workflow completed successfully in **32 minutes 09 seconds**, including
runner provisioning and ACS cache preparation. This upstream/dependency-changing
build is not a repeat of the previously measured warm-build pair. Both required
ACS cache entries reported Ready. A separate disposable Pod proved an actual
cache hit for this exact release as the main image and both supported init paths,
with successful exits, zero restarts and the correct embedded application version.
The probe was removed with its recorded UID after evidence collection.

At the initial owner-only admission check, both CIS roles reported
`updateAvailable=true` and `manualUpgrade=true` from the owner's
`0.1.119-cloud.6`. Other instance records and Pod UIDs were unchanged and new
claims still selected `0.1.119-cloud.3` at that stage. The full 16-entry runtime qualification list
required retiring the unused `0.1.108` entry from keyring and native-maintenance
qualification together. Live templates, recovery source journals and active
operations were checked first; existing native/new-claim selection stayed equal.
No image or backup was deleted.

The owner upgrade completed through the deployed maintenance service. Its stopped,
read-only-PVC OSS backup contained **3,457 files / 718,233,796 encrypted bytes**.
Both main and init use the delivered digest, the actual owner Pod hit the qualified
ACS cache, and readiness passed with zero restarts after maintenance release.
Database table counts/content and schedule definitions were preserved; the new
notification column was present with the expected default. All 25 captured
preference-file names remained present: 22 file hashes were unchanged; the other
three changed only migration bookkeeping or projection transition IDs/timestamps.
No user preference value changed in that comparison.

The real cloud desktop passed packaged native X11 mouse/text input in the terminal
and personal Chrome, including Chinese, Emoji, backspace and Return, minimize /
restore, Chrome fullscreen geometry, locked Dock items and disabled preferences.
Only disposable acceptance windows were created and closed. This is native Linux
input evidence, **not** a new end-to-end DeviceLink transport or OAuth test.

The installed Mac Dev started after Keychain access. Both the sidebar shortcut
and Settings → Cloud instances → Instance settings opened the real owner target.
All six IM default-model domains returned ready; personal WeChat displayed the
shared new-conversation configuration. The 25 exposed domains returned 23 ready
and two conditional unavailable results (`telegramGroups`, `chatEmbedding`),
matching the previously recorded behavior rather than read/schema failures.
These conditions do not imply permanent platform limitations.

A real UI change disabled cloud system notifications. Closing and reopening the
page read back false, and an independent read of the cloud preference file
confirmed persistence. The Mac Dev preference file stayed byte-for-byte unchanged.
The original setting had no override, so the existing public cloud save API then
cleared that override; disk and reopened UI both returned to the original state.
No notification preference or test window was left behind.

After both live checks passed, the API and orchestrator admission policies were
updated and verified independently. All **11 other running organization instances**
report this exact release as available for manual upgrade; their original
maintenance windows and automatic-update preferences remain unchanged. Their
records and Pod UIDs were unchanged during admission, and no upgrade was forced.

The organization instance already stopped remains stopped with auto-update off.
Its exact image/init approval is prepared, but it has no maintenance enrollment,
so the current API correctly does not advertise a manual maintenance upgrade.
The stopped personal test instance and its entitlement were unchanged.

New-claim selection now resolves to `0.1.120-cloud.1` on both CIS roles. The real
provider's pure manifest builder was also checked: main and the owned volume
initializer both use the same delivered digest. No instance was created solely
to prove that selection.

The admission review retained the existing login-wait startup probe qualification
for the affected older profile. One native instance still has a v1 enrollment;
the deployed native upgrade transaction already advances its owned initializer
and binding to v2 during the backed-up image update. Enrollment and templates
were inspected without rewriting them during admission. The completed owner
operator and cache probe were removed with UID preconditions.

Only the fork feature branch is updated. The post-build fixture correction and
these documentation changes do not alter the delivered source or image and do
not trigger another cloud-image delivery.

## cloud.2 owner delivery (2026-10-31)

[Delivery run 41161353870](https://github.com/zhuoshaojian/cindy/actions/runs/41161353870)
built recipe `7b29af0d27` from source `4a9dcadf94` (runtime notification management items for
WeCom group webhook, Feishu and Discord notices). It published
`cloud-runtime-cn:0.1.120-cloud.2-cn-amd64` at
`sha256:202dba2f7fcb560813561527e570f450c3b59d365b08a6faf59df11634ef5573`. All five build
records, native SQLite/vec/PTY checks and the isolated Linux smoke passed; both ACS cache
entries were Ready and a disposable probe proved main and init cache hits with the embedded
application version, then was removed by UID.

The matching Dev client `0.1.120-dev.cloud.20261030.5` was installed first. Owner-only
admission then added the release to the owner profile and the keyring list, retiring the
unreferenced `0.1.108-oauth-browser.20261016` keyring/maintenance entry and the owner's unused
`0.1.108-xfce-dock-r5c.20261020` approval. Global native admission and new-claim defaults were
not changed; both CIS roles confirmed only the owner instance may upgrade and other records and
Pods were unchanged.

The owner upgrade passed through the maintenance service: stopped read-only OSS backup of
3,548 files / 726,998,206 encrypted bytes, databases and schedules preserved, main and init on
the delivered digest with an actual cache hit, ready with zero restarts and maintenance
released. Live IM notification acceptance is recorded in
[the settings parity inventory](../../docs/cloud-settings-parity.md). Other instances remain on
their current release until a separate fleet admission.

## cloud.2 fleet admission (2026-10-31)

The owner authorized fleet admission after the `.6` client checks, explicitly skipping a real
WeCom webhook success path (covered by synthetic tests only). Before admission, CIS
`cis-0d9ae0d0` (based on the live `f0f2cfe3`) was delivered so the web console omits the new
native-only `management.botNotifications` group instead of showing raw keys.

A fresh baseline (14 records, no active maintenance) matched the earlier one with no record
changes, and the re-prepared policy was byte-identical to the reviewed candidate; both roles
loaded it with their deployed schema. Immutable `cis-u120c2-1031-fleet-*` ConfigMaps were rolled
out orchestrator then API, both ready with zero restarts. The change set new-claim defaults,
placements and tenants to cloud.2, added cloud.2 to native maintenance admission (12 to 13),
and gave the 12 other org instances an exact cloud.2 approval. Each verified profile at the
16-entry cap retired one unreferenced old approval; backup, access, automation, settings web,
invitations, credential pilot and legacy versions were unchanged.

Both roles confirmed: the 10 running org instances on cloud.1 report cloud.2 as their update,
the owner is already current, the two stopped instances only received approvals, and a dry-run
new-claim manifest uses cloud.2 for main and init without creating an instance. Images, power
state, auto-update preferences, resources, maintenance policies and Pod UIDs of every record were
unchanged; no instance was upgraded or restarted by admission. Running instances move in their
own maintenance windows according to their auto-update preference. The personal instance is out
of scope. Dev test clients `.4` and earlier will show the notification items as extra generic
cards once their instance is on cloud.2; official clients have no cloud settings.
