# Upstream 0.1.128 alignment

The cloud stack is rebased onto official `v0.1.128`
(`9d62b213c960c63daa46996de8a606965f2f2299`, released 2026-11-06). The history stays
linear, with no merge commits, in the same order as the
[0.1.126 alignment](UPSTREAM-0126.md):

1. The generic seams for showing another computer's settings.
2. The generic fixes: the Linux clipboard generation and the Telegram persona
   recovery.
3. The cloud-only commits, the 0.1.125 and 0.1.126 adaptations and their releases
   through 0.1.126-cloud.4.
4. The v0.1.128 adaptation and this release.

The 0.1.126-cloud.4 history from before the rebase is kept as
`backup/cloud-settings-native-client-0126`. The source freeze names it as
`cloudParent`. Release identity: `0.1.128-cloud.5`.

## Compatibility decisions

Upstream added 515 commits. Electron (42.11.12) is unchanged. The lockfile only adds
the new `@cindy/gitlab-client` workspace package.

- **Settings search.** Upstream moved each section's search entries into a
  definition file next to the section and reads titles, anchors and control markers
  from it. The cloud page renders the same section views as the local page, so these
  definitions now live in the shared views, and both pages render the same anchors.
  The cloud page's IM cards keep their prefixed anchors, and the anchor guard test
  accepts them. The shared settings sidebar carries upstream's plugin-interface
  marker and back-button search action.
- **Plugin shortcuts.** Upstream stores plugin shortcut bindings in the same file
  as the app shortcuts. The Host's write gate for that file accepted only app
  shortcuts. An instance with a plugin binding could not save a shortcut. The gate
  now accepts plugin bindings, and a Host edit keeps them.
- **Plugin appearance.** Upstream lets a plugin set themes, reading width, content
  style and plugin fonts, stored in the appearance file. The Host's write gate
  rejected these fields, so a plugin's appearance could not be saved on an
  instance. The gate now accepts each such field when upstream's reader would keep
  it and still rejects malformed values.
- **Model aliases.** Upstream groups models that are aliases of each other when
  their settings agree. On the cloud page, grouping uses the instance's visibility
  and effort, never this computer's model stores. A group's effort edits and its
  model enable or disable go to the instance, as single-model edits do.
- **Cloud packaging.** The cloud build removes desktop auto-update from the settings
  catalog. The About definitions are now a map that the About page also reads, so
  the build filters the entry out of the catalog instead of deleting its line.
- **Translations.** Upstream's glossary now forbids 「外掛」 in Traditional Chinese.
  The cloud page's plugin notice uses 「插件」.

The upgrade operator's data checks need no change. Migration 0145 is empty, and
0146 and 0147 add the new `pi_usage_receipts` table. Sessions, messages and
schedules are unchanged.

## Checks

These ran on a macOS checkout and are not real-account acceptance:

- Desktop, Mobile, `@cindy/mcps` and `maker-core` type checks: clean.
- Desktop tests: every test file touched by the cloud stack passes. The remaining
  10 failing files (git-integration suites, the database proxy timing test and the
  hosted Claude and Codex e2e) fail identically on a clean `v0.1.128` checkout in
  the same environment.
- `@cindy/mcps` and the `maker-core` agent suites pass.
- Recipe checks: node 140 passed, 1 skipped; all Python suites pass.
- `stage-cloud-overlays.mjs` applies all 30 overlays to the frozen source.

## Delivery

The first image build stopped at the delivery check. Upstream's settings definitions
now import shared appearance, locale and voice modules and two workspace packages,
and the check's sparse checkout lacked them, so the cloud catalog test could not
bundle. `5dafd3de1f` checks them out and resolves workspace packages through their
exports. The rebuilt `0.1.128-cloud.1` image passed the native startup smoke test,
reached the image cache, and a cache probe in the cluster read the application
version from the image.

## Owner acceptance

Only the owner's instance was approved for and upgraded to `0.1.128-cloud.1`. Other
instances, the cloud.4 fleet admission and the defaults for new instances are
unchanged. The instance was idle, so the upgrade was not skipped.

The upgrade stopped in recovery-hold. Backup, source shutdown and the switch to the
new image completed, but about 88 seconds after the candidate started, a CIS check
of the candidate hit `KUBERNETES_EXEC_TIMEOUT`. Read-only checks showed the
candidate healthy:

- It runs `0.1.128-cloud.1`, its asar matches the qualified image, and every
  readiness item is ready.
- It was sealed with no work.
- The databases pass integrity checks, and sessions, messages and schedules match
  the sealed snapshot. No new crash dumps appeared.

With the owner's consent, the operation was completed the same way as the cloud.7
hold: CIS's verified-profile check ran again, then the instance was marked
verified, released and finished, without a restart. The final check found main and
init images updated, the pod ready without restarts, the cache hit, maintenance
released, and no active operation. Peer records were unchanged.

The Dev client `0.1.128-dev.cloud.20261107.1` was used against the real instance:

- The cloud page loads all ten tabs and reports `0.1.128-cloud.1`. The sole
  instance is named 「云端 Cindy」.
- The language menu lists all twelve languages.
- The providers tab lists the instance's catalog and models with no page errors.
  The advanced drawer's image-input row reads from the model catalog.
- The remote desktop showed live video of the instance on the first open.

Open issue: a CIS exec timeout while a new version starts sends the instance to
recovery-hold instead of retrying the check.

## Fleet rollout

On 2026-11-07, after the 09:00 check found all ten running instances on
0.1.126-cloud.4, the owner asked to admit `0.1.128-cloud.1`.

The fleet policy does three things:

- It approves `0.1.128-cloud.1` for every organization instance.
- It moves the default for new instances to `0.1.128-cloud.1`.
- It adds the image to native maintenance admission.

Each instance's automatic update setting, maintenance window, scheduled task
policy and backup policy are unchanged. After deployment, new claims select
`0.1.128-cloud.1`. The ten running instances on cloud.4 report the update and
upgrade in their next window (03:00–05:00). The owner's instance is unchanged, and
the two stopped instances are not upgraded by maintenance.

## cloud.2: quieter logs and clearer login errors

Cloud.2 (`a41bfacd73`, three cloud-only commits) fixes leftovers from the cloud.1
rollout. The CIS side of that rollout's open issue is fixed separately: CIS
`198603ca` samples a timed-out runtime read again within the step deadline instead
of holding the instance.

- **Instance logs.** The instance's endpoint manifest leaves `heartbeatUrl` empty and
  has no chat endpoint. The heartbeat failed every minute on the relative
  `/heartbeat` URL, and each retried group read logged `CHAT_ENDPOINT_UNAVAILABLE`
  about twice a minute (1,439 and 2,878 lines on 2026-11-08 on the owner's
  instance). The heartbeat no longer starts for an empty endpoint, and the missing
  chat endpoint is logged once per chat service.
- **Wrong account.** Signing in to an instance with an account other than its owner
  showed 「暂时无法登录」 and 「登录失败，请稍后重试」 above the real reason. The panel
  now names the mismatch, shows the reason once, and offers another account.
- **Login window end.** The end request that a reset or closed login window sends
  while unmounting is now a no-op instead of a logged `SCOPE_CHANGED` IPC error. The
  reset has already cancelled that window's login attempts.

### cloud.2 owner acceptance

On 2026-11-09 the image was built by run 42553549569 from `75e077bda1`
(`0.1.128-cloud.2-cn-amd64@sha256:297b5e8c…`). It passed the native smoke and matched
the ACS image cache. Only the owner's instance was approved; defaults, placements and
the other instances' approvals were unchanged.

The owner's instance had no running work. Its upgrade from cloud.1 took about eight
minutes: prepare, seal, an encrypted backup of 4,012 files, the switch, the candidate
check and release. It completed without a recovery-hold. No runtime read timed out
during this upgrade, so CIS `198603ca`'s retry did not run here; its tests cover it.

After the upgrade:

- The new Pod is Ready with no restarts, uses the cached image, and reports
  `0.1.128-cloud.2`. Databases and schedules are preserved. The other twelve instance
  records are unchanged.
- In the first eight minutes the instance logged no heartbeat line (eight failures
  were expected before), and the missing chat endpoint once (about sixteen before).
- The Dev client `0.1.128-dev.cloud.20261109.1` shows the instance on
  `0.1.128-cloud.2` and opens its settings without errors.

The wrong-account panel and the quiet login window end are covered by tests only:
the owner's instance is signed in, so its login window does not open.

### cloud.2 fleet rollout

On 2026-11-09 the owner said to admit cloud.2 and upgrade the whole fleet, and chose
active upgrades now over the next maintenance windows. The fleet policy approves
`0.1.128-cloud.2` for every organization instance, makes it the default for new
claims and adds it to native maintenance admission. Each instance's automatic update
setting, maintenance window, scheduled task policy and backup policy are unchanged.

The ten other running instances were then upgraded one at a time between 12:20 and
13:54, each with its own encrypted backup. None had running work, so none was skipped,
and none went into a recovery-hold.

The ninth instance's first attempt was refused by CIS with
`MAINTENANCE_RUNTIME_UNVERIFIED` about a second after it started. No operation was
claimed and nothing on the instance changed: it stayed on cloud.1, ready, with no hold
or paused release. The likely cause is that its record changed between the operator's
read and the claim. A retry three minutes later completed.

Afterwards all eleven running instances are on `0.1.128-cloud.2`. Every Pod is Ready
with no restarts, and no maintenance operation is active. Only the image changed on each
record; the two instances with an applied resource change also had their binding hash
recomputed for the new image, with the same tier. The two stopped instances were not
started or upgraded.

## cloud.3: the cloud pages on the CIS web page

Cloud.3 (`adf5e90de4`, three cloud-only commits) lets the instance owner's signed-in
browser use the client's own cloud pages: the instance list, the whole instance
settings panel, and remote desktop in a browser tab. CIS serves the pages and relays
their calls; this release adds the instance side.

- **Host calls from the browser.** The DeviceLink calls those pages make (four private
  cloud settings channels, three read channels, remote desktop signaling and the ICE
  configuration) now also arrive through the CIS settings relay. The instance answers
  them with the same handlers and checks it uses for DeviceLink, and treats each
  browser session as one controller.
- **Declaration.** The instance declares these calls when it registers with CIS. An
  older CIS rejects the new fields; the instance then registers without them, as
  before, and the browser pages show those parts as unavailable.
- **Signaling latency.** After a held poll the instance polls again at once instead of
  waiting two seconds, so desktop signaling is not delayed.

The browser pages are built from the same commit (`deploy/cloud-web/pack.py`); CIS pins
the archive by checksum. Native clients are unaffected.

### cloud.3 owner acceptance

On 2026-11-09 CIS was deployed first (`1ecd23b6`): it hosts the web pages at
`/instance-login/app/` and relays the new Host calls, both off by default. Only the
owner's instance is on the web page list (`settingsWeb.webAppInstanceIds`).

The owner's instance first waited for its disk expansion (20 → 30 GiB), which another
change completed. It was then upgraded alone through the standard maintenance flow.
The upgrade made an encrypted backup of 4,021 files and released maintenance without a
recovery-hold. The new Pod is Ready with no restarts, uses the cached image and reports
`0.1.128-cloud.3`. Databases and schedules are preserved, and the other instance records
are unchanged. Its automatic update setting and maintenance window are unchanged, and
new claims still select cloud.2.

In a browser signed in to CIS as the owner, against the live CIS and instance:

- The sign-in page sends the owner to the client's cloud pages. The instance list and
  every settings category load, including the companion model (model catalog and
  provider list) and storage usage (29.36 GB disk). Both now go through the relay.
- Remote desktop opens in its own tab and connects with video through the server relay
  (1280×800), with control. Disconnecting stops the session and closes the tab.
- "Open in cloud desktop" in settings opens the same tab (fixed in `84fd0cb2e1`, CIS pin
  `3f7e84a0`).

Not covered: OAuth sign-ins from the web (the callback is pasted by hand, as on the old
page), and plugin credential forms, which stay native-only by design. The fleet stays
on cloud.2 until the owner says to admit cloud.3.

### cloud.3 fleet rollout

On 2026-11-09 the owner said to admit cloud.3 and chose active upgrades now. The fleet
policy approves `0.1.128-cloud.3` for every organization instance and makes it the
default for new claims. Each instance's automatic update setting, maintenance window,
scheduled task policy and backup policy are unchanged.

The ten other running instances were upgraded one at a time, each with its own
encrypted backup. Two notes:

- `23a66573` was released and healthy on cloud.3, but CIS stopped it in a
  recovery-hold during the five-minute post-release observation
  (`MAINTENANCE_RUNTIME_UNVERIFIED`). A read-only check found the same boot, an
  advancing heartbeat and no unknown work. With the owner's consent it was finished
  the same way as `6b395d7a` on 2026-11-06: operation completed and lock cleared,
  without a restart.
- `4e017bac` had running work and was skipped; it upgraded on the retry at the end.

Afterwards all eleven running instances are on `0.1.128-cloud.3`, Ready with no
restarts and no maintenance hold. The two stopped instances were not started or
upgraded. The CIS web page now sends every owner to the client's cloud pages
(`settingsWeb.webAppAllInstances`).

## cloud.4: the rest of the instance settings on the CIS web page

Cloud.4 (`22572449d1`) lets the CIS web page show what the native cloud settings page
already shows for an instance. A side-by-side check of the two found these parts missing
on the web; CIS accepts their calls since `ec71162b`.

- **Account quota.** Cindy AI (XD) and Codex quota on the provider pages
  (`maker:usage:account`, `maker:usage:codex-rate-limits`).
- **Model favorites** in the model pickers (`maker:model-favorites:get` / `apply`).
- **Remote and share page** of the instance's own providers: model scope, provider
  group, share visibility, remote task limits and usage (`provider-group:remote`). From
  the browser the instance takes only the owner's provider management requests; group
  scheduling and continuity stay between the owner's computers. Join requests for a link
  created on the web page are approved in that page's request list.
- **Received share quota and usage.** The provider settings channel's guest share actions
  add `insights` and its list advertises `shareActions`; the cloud page reads a received
  share's quota and usage through the instance, the share member. Before cloud.4 the native
  page keeps reading them on its own computer.

The instance answers these with the handlers and DeviceLink context a same-account
controller gets, as for the cloud.3 calls. Instances before cloud.4 do not declare them;
the web page shows those parts as needing an update. Native clients are unaffected,
except that on a cloud.4 instance the cloud page reads received share insights through it.

## cloud.5: links open in the Dock's Chrome

Cloud.4 was built (run `42785360731`) but not rolled out; cloud.5 replaces it with the
same app source (`22572449d1`) and two runtime image fixes. A colleague's XD Feishu
reauthorization showed "Failed to execute default Web Browser: Input/output error"
instead of opening the authorization page.

- **Shell permission checks.** The instance seccomp profile predates `faccessat2` and
  denied it with EPERM. glibc's `faccessat` falls back to the allowed call only on
  ENOSYS, so under the filter every shell `test -x` / `-w` was false, for Cindy, its
  agents and the desktop alike. `sensible-browser` found no browser and exited 1. The
  launcher now answers `faccessat2` with ENOSYS, as it does for `clone3`; the allowlist
  is unchanged.
- **Default browser.** Xfce's preferred browser was `sensible-browser`, which starts
  Chrome's default profile, an empty second Chrome beside the Dock's personal profile.
  The image now makes the Dock's Chrome launcher the system default. A user's own
  `~/.config/xfce4/helpers.rc` still takes precedence.

The image smoke checks both under the shipped filter.
