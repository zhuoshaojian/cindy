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

## Fleet admission (2026-11-02)

The owner authorized fleet admission after the real client acceptance. A fresh baseline
(14 records, no active maintenance) preceded preparation; both roles loaded the candidate with
their deployed schema. Immutable `cis-u121c1-1102-fleet-*` ConfigMaps were rolled out
orchestrator then API, both ready and stable. New-claim defaults, placements and tenants now
select `0.1.121-cloud.1`; cloud.1 joined native maintenance admission (12 to 13); the 12 other
organization instances received exact approvals, and each verified profile at the 16-entry cap
retired its oldest unreferenced approval. Backup, access, automation, settings web,
invitations, credential pilot and legacy versions were unchanged.

Both roles confirmed that the 10 running organization instances on `0.1.120-cloud.2` and the
stopped auto-update instance report cloud.1 as available; the stopped instance with auto-update
off has no maintenance enrollment and is not offered an upgrade; the owner is current. A dry-run
new-claim manifest uses cloud.1 for main and init without creating an instance. Images, power
state, auto-update preferences, resources, maintenance policies and Pod UIDs were unchanged; no
instance was upgraded or restarted by admission. Running instances move in their own maintenance
windows according to their auto-update preference. The personal instance is out of scope.

## cloud.2: provider settings channel (2026-11-02)

The user asked for the cloud providers page to match the local page. `0.1.121-cloud.2`
(freeze `d28b406429`, delivery `0c42ed6e57`) adds the private DeviceLink channel
`cloud:provider-settings:v1`, registered only on managed instances and only for the instance
owner. It returns the full provider catalog the local page uses (hidden and payment-locked
models included, routing projected, no credentials) and writes model visibility (CAS on the
Host revision), model/provider disable, order, presentation, remote access and model refresh
through the native handlers. Logins, API keys and new connections stay on the CIS tickets.

Delivery run 41405831375 passed verify, candidate (two layers, native smoke on
`0.1.121-cloud.2`, five records) and cache; an in-cluster probe hit the qualified cache and
read the packaged version. The owner-only policy changed only the owner's verified profile and
the approval lists (one unreferenced `0.1.108` approval retired at the cap); defaults,
placements, tenants, schedules and backup were unchanged, and both roles rolled out ready.

The owner upgrade backed up **3,545 files / 726,892,629 bytes**, started main and init on the
delivered digest with a cache hit, became ready with zero restarts, released maintenance and
preserved databases, schedules and peer records. Other instances stay on `0.1.121-cloud.1`.

With the Mac Dev `0.1.121-dev.cloud.20261102.2` (`68e8af43e6`) the channel listed 8 providers in
79 ms (244 KB) and rejected an invalid request. Through the real UI: hiding a model wrote the
override to the instance and a reset restored it; keyboard reordering wrote the instance order
and the original order was restored (the stored order keeps a deleted provider id, so writes
send only current ids); the remote access switch toggled on and back off; disabling a model
from the drawer and re-enabling it inline both wrote and read back. The final state equals the
baseline. Third-party login, API key entry and an older-runtime fallback were not exercised
live (the fallback is covered by unit tests). Fleet admission has not been requested.

## cloud.4: second batch of provider settings (2026-11-02)

`0.1.121-cloud.3` (freeze `51f9cc05e7`, run 41421964109) was cancelled before delivery and was
never cached or approved; cloud.4 supersedes it with a model panel fix and the shares work. `0.1.121-cloud.4` (freeze
`25ce5ac5de`, delivery `7aec2f3d9b`) extends `cloud:provider-settings:v1` with model panel
calls (context limit, compaction and price overrides through the native handlers, stamped with
the instance owner), reasoning effort in the instance Host history, protocol and image/video
capability edits applied to the instance's full custom provider config, an instance CLI scan,
and the owner's guest share actions (received list, trust the sharer, leave). Other share
commands are rejected on the channel. The user chose to show only existing local models; there
is no download, start or delete for instance models.

Run 41425144350 attempt 1 failed in candidate when github.com returned HTTP 500 for the Codex
release download; the failed jobs were rerun unchanged and attempt 2 passed verify, candidate
(native smoke on `0.1.121-cloud.4`) and cache. An in-cluster probe hit the qualified cache. The
owner-only policy added the cloud.4 approval and pinned only the owner's verified profile;
defaults, schedules and backup policy were unchanged and both roles rolled out ready.

The owner upgrade from `0.1.121-cloud.2` backed up **3,552 files / 726,999,407 bytes**, started
main and init on the delivered digest with a cache hit, became ready with zero restarts, released
maintenance and preserved databases, schedules and peer records. Other instances stay where
their own update preferences put them.

With the Mac Dev `0.1.121-dev.cloud.20261102.4` (`7aec2f3d9b`) the channel advertised the new
operations and rejected a share link creation. Through the real UI: the Cindy AI quota module
matched the local page; the instance's CLI scan found Claude Code and Codex and suggested only
Anthropic because OpenAI is already listed (same rule as local); the model panel set reasoning
effort to high (provider and preset slots) and cleared it, and set a 200K context limit and
reset it; the received share opened and its trust switch wrote to the instance and was turned
back. Clearing an effort leaves empty memory slots, as the local page does; there is no effect
on defaults. Protocol and capability edits, price writes, third-party login, API key entry and
joining a share by link were not exercised live. `cd4d5099ba` hides the received shares group on
runtimes without the share operation so an older instance never shows this computer's shares;
it ships in the Mac Dev from `.5`. Fleet admission has not been requested.

## cloud.6: third batch of provider settings (2026-11-02)

The third batch makes the cloud page open the local add-provider wizard and connection dialog
and follow the local header rules (built-in sign-in buttons, Cindy AI credential menu without
copying the key, organization config refresh, Fast, Codex reset credits, usage links and the
DeepSeek and Zhipu balance modules, editing custom connections). Deleting a provider now asks
first, as it does locally (`b99fea3b05`). Steps without secrets use `cloud:provider-settings:v1`;
API keys, request headers and sign-ins are staged on the channel without secrets and run through
the CIS management ticket `setup:apply`, so no secret crosses DeviceLink. The CIS web console
hides that ticket from its generic list (cindy-server `378ec50e`, deployed by CIS delivery
41461306855).

`0.1.121-cloud.5` (freeze `9872c64cb7`, run 41462017983) was cancelled before delivery and was
never cached or approved: the instance Codex sign-in still required an Electron window owner.
`0.1.121-cloud.6` (freeze `c3a376909c`, delivery `9cd94c7851`) signs the instance Codex in by
device code without a window and shows provider device codes on the management card.

Run 41463026713 attempt 1 failed in candidate: a 110 MB npm tarball arrived at 37 KB/s, the
install step took 56 minutes, and the one-hour build cache token had expired when the cache
export started (401). The failed job was rerun unchanged; attempt 2 passed verify, candidate
(native smoke on `0.1.121-cloud.6`, build inputs bound to `c3a376909c`) and cache, and an
in-cluster probe hit the qualified cache. A build that runs longer than an hour fails the same
way and is safe to rerun. The owner-only policy added the cloud.6 approval, pinned only the
owner's verified profile and retired one unreferenced `0.1.113-cloud.28` keyring approval at the
cap; defaults, placements, tenants, schedules and backup policy were unchanged and both roles
rolled out ready.

The owner upgrade from `0.1.121-cloud.4` (baseline retaken just before: 14 instances, no active
maintenance) backed up **3,556 files / 828,470,681 bytes**, started main and init on the
delivered digest with a cache hit, became ready with zero restarts, released maintenance and
preserved databases, schedules and peer records. The other 13 instances were not touched.

With the Mac Dev `0.1.121-dev.cloud.20261102.7` (`948983cc61`; `c3a376909c` changes only the
instance runtime) the channel advertised all 29 operations. Through the real UI, compared with
the local page of the same Dev app:

- Delete asks first: deleting the built-in OpenAI showed the local confirmation and cancelling
  left the instance catalog unchanged; a temporary connection was deleted after confirmation.
- The add wizard matches the local one (steps, groups, ElevenLabs, more local services, custom
  endpoint last) without Ollama and the managed llama.cpp entry, as agreed; the DeepSeek, OpenAI,
  xAI and custom endpoint forms are identical. An unreachable no-key endpoint
  (`127.0.0.1:9`) gave the same detection and test messages as local, saved on the instance,
  opened in the edit dialog with the instance's name, address, auth and runtime, was renamed and
  then deleted.
- Headers and menus match: Cindy AI offers fetch credentials again, rotate and disconnect (no
  copy key, by request); fetching again ran on the instance and stayed connected; rotate and
  disconnect showed the local confirmations and were cancelled. Organization connections show
  refresh organization config (busy, then ready) and no model refresh. The built-in OpenAI shows
  use this computer's Codex account and Fast.
- Fast on the subscription account wrote `allowFast:false` to the instance and was turned back.
- The Codex quota card shows the weekly limit and the instance's free reset; it was expanded but
  not used (one available before and after).

Two differences were found and fixed. The cloud header offered disconnect for a connected no-auth
custom endpoint, while the local header offers it only for a key endpoint (`ac61a8b763`); with
the Mac Dev `.8` the no-auth endpoint shows only configured and a key endpoint still shows
disconnect. Saving a key endpoint right after typing the key collided with the form's keyed
detection, which held the instance's ticket operation, so the save was cancelled while the local
form saves; saving after the detection worked, the key reached the instance only through the
ticket and the returned catalog carried no key (a placeholder key was used and the connection
deleted). `1644842a42` queues ticket operations, waits until the instance is idle and keeps
only the latest keyed detection; a unit test fails on the old behaviour. It ships in the Mac
Dev `.9`, whose live check waits for its Keychain prompt.
The final instance catalog, Fast policy, Cindy AI and organization states equal the baseline.
Not exercised live: the third wizard step (needs a real key or sign-in), DeepSeek and Zhipu
balances and the Claude and Grok usage links (no such connection on the instance), third-party
sign-in and real API keys. Fleet admission has not been requested.
