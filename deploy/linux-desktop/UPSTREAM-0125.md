# Upstream 0.1.125 alignment

The cloud stack is rebased onto official `v0.1.125`
(`ac785430449042f120a296b881a25ae52333f1e1`, released 2026-11-04). The history is
linear, with no merge commits, so that the generic commits can be offered upstream
separately:

1. The generic seams for showing another computer's settings: the IM cards' settings
   target, MCP dialog persistence, and the storage overview. These are the same
   changes as `refactor/settings-target-im-cards` on upstream `main`.
2. The generic fixes: the Linux clipboard generation and the Telegram persona
   recovery. These are the same changes as `fix/linux-clipboard-generation`.
3. The cloud-only commits: client and runtime through cloud.8, the instance prompt
   and IM settings, the 2026-11-04 review, and the storage page fix.
4. The v0.1.125 adaptation, translations, build staging, overlays and this release.

The cloud.10 history from before the rebase is kept as
`backup/cloud-settings-native-client-0121`. The source freeze names it as
`cloudParent`. Release identity: `0.1.125-cloud.3`.

## Compatibility decisions

Upstream added 1,937 commits. Electron is unchanged (42.11.12).

- **Smart Contacts.** Upstream retired the built-in Smart Contacts in favour of the
  `cindy-contacts` plugin.
  - The frozen CIS v2 fields `contacts.enabled` and `contacts.deviceSyncEnabled` keep
    their IDs and always report `unsupported`.
  - The `contacts` and `contactsSync` setting domains stay in the wire catalog.
    Reads return `unavailable`; writes return `UNSUPPORTED_CAPABILITY`.
  - The management section `contacts` stays valid and is empty.
  - The cloud page no longer shows the section.
  - The retired IM and management channels left the private allowlists.
- **Session import.** Upstream's new importer replaces `claude-local-sessions`. A
  pilot build still reads Claude Code projects from its managed configuration root.
- **Image input.** The model panel's image-input override routes through the
  instance's model calls (`image-input` operation). Runtimes before cloud.1 report
  it unavailable, and the control is disabled.
- **Default permission for new tasks.** On a cloud instance, upstream's new setting
  is kept in window storage beside the workspace draft. It is not in the Host
  history, because older runtimes reject unknown history fields.
- **Classical editions (文言).** The host locale copy carries upstream's classical
  reply style in window storage, as upstream does.
- **Display languages.** Upstream now has twelve display languages. CIS
  `4ddf33fa` accepts all of them, plus `system`, for `desktopGeneral.locale` and the
  read-only `desktop.locale`. Before it, the contract carried five and `system`.
  - From cloud.3, the instance lists its accepted languages in the `desktopGeneral`
    locale choices. The cloud page and the CIS web offer the newer languages only
    when the instance lists them. Older instances keep the original six, so neither
    surface offers a value they would reject.
  - Cloud.1 offered all twelve before CIS accepted them, which showed an unconfirmed
    save. Cloud.2 kept the page to the six values.
  - An instance whose own language is outside the wire reports `desktopGeneral` as
    `unavailable`. The cloud page then points to the cloud desktop, and the rest of
    the page still loads. Cloud.2 does this for all seven newer languages.
  - A test ties the wire list to upstream's supported locales. A future upstream
    language must reach CIS before an instance can report it.
- **Translations.** The 301 cloud strings are translated into the seven new
  locales.
- **Linux input.** Upstream's input helper now also has an X11/XTest backend. The
  managed X11 desktop keeps the fork's guarded adapter, and the XTest path is
  excluded there. The build stages libXtst, libXi and libXfixes so the bundled helper
  still compiles. Switching the cloud desktop to upstream XTest is a separate change
  that needs native and real-device acceptance first.
- **Overlays.** The maintenance overlay anchors on upstream's new Once-claim wake
  line. The window overlay test follows upstream's `minimizeWindow`, which stays a
  native minimize on Xfce.

Migrations 0137–0144 are retained unchanged:

- `sessions.project_dir` is nullable and is not backfilled.
- New tables: `session_imports` and `github_observations`.
- `session_pr_refs` gains association columns.
- `schedules` gains `pre_run_plugin_id` and `pre_run_plugin_on_failure` through
  script 0140. Both are nullable and stay null for existing rows.

The upgrade operator's data checks must allow these additions, and must still
require existing rows, IDs and schedule definitions to be unchanged.

## Checks

These ran on a macOS checkout and are not real-account acceptance:

- Desktop and Mobile type checks: clean.
- Desktop tests: every test file touched by the cloud stack passes. The remaining
  failures (git-integration suites, several local-database suites, a hosted Claude
  e2e, a viewport test) fail identically on a clean `v0.1.125` checkout in the same
  environment.
- Recipe checks: node 140 passed, 1 skipped; all Python suites pass.
- `stage-cloud-overlays.mjs` applies all 30 overlays to the frozen source.

## Owner acceptance

Only the owner's instance was upgraded. It was idle both times, so neither upgrade
was skipped. Other instances and the defaults for new instances are unchanged.

**cloud.1.** The upgrade completed with an encrypted backup, unchanged databases
and schedules, and the two new schedule columns. The Dev client then found one
problem. The cloud page offered all twelve display languages, and CIS rejected
文言 as an unconfirmed save. The instance value was not changed.

**cloud.2** freezes `41dc15701b` and keeps cloud display languages to the CIS
contract. It went through the same upgrade checks. The Dev client
`0.1.125-dev.cloud.20261105.2` was used against the real instance:

- The cloud page loads every tab. It reports `0.1.125-cloud.2`, and contacts are
  absent.
- The cloud language menu offers the six contract values. The local menu keeps
  all twelve. Saving 日本語 and then 简体中文 succeeded.
- With the instance's own language set to Español in the cloud desktop, the cloud
  page still loaded. The language row pointed to the cloud desktop, and no read
  failure was shown. The instance language is back to 简体中文.
- The image-input override saved to the instance's model catalog overrides and was
  reset afterwards.
- Remote desktop: clicks and typing reach the instance. Upstream's computer privacy
  screen, lock on exit and idle lock all show as unsupported on the instance, so
  their new defaults do not lock the cloud desktop. Reopening the viewer finds the
  desktop unlocked.
- The first viewer session after the cloud.2 restart showed a frozen first frame.
  Input still reached the instance. Closing and reopening the viewer restored live
  video, and the later sessions stayed live.

**cloud.3** (`f0ad1aae27`, with CIS `4ddf33fa`) passed the same owner upgrade checks.
The Dev client `0.1.125-dev.cloud.20261105.3` was used against the real instance:

- The cloud language menu matches the local one, with all twelve languages. Against
  cloud.2 it kept the original six.
- Saving Français, 文言 and Deutsch reached the instance (`fr`, `zh-Hans-x-lzh`,
  `de`), and the page read each value back. Choosing 繁體 under 文言 saved
  `zh-Hant-x-lzh`. The instance language is back to 简体中文 (`zh-CN`).
- One switch from 文言（繁體）to 简体中文 briefly showed `zh-Hans-x-lzh` on the
  instance before `zh-CN`. Two repeats watched on the instance went straight to
  `zh-CN`.
- On the cloud page, 文言 offers the script (简体 / 繁體). The reply style stays in
  the instance's own window, as the cloud.1 decision describes.

## Fleet rollout

After the owner acceptance of cloud.2, it was admitted for every organization
instance, with new instances defaulting to it. No instance was upgraded by hand.
In the 2026-11-06 03:00–05:00 window, CIS upgraded all ten running instances with
automatic updates on. Stopped instances and the one with automatic updates off were
left unchanged.

One native instance stopped in `recovery-hold` with `MAINTENANCE_RUNTIME_UNVERIFIED`
during the five-minute post-release observation. Its runtime had released on the new
image and was healthy. With the owner's approval, the operation was completed by hand:

- The live state was re-verified: released by the same command on a new boot, a
  heartbeat advancing, no unknown activity, and matching image and update annotation.
- Only the operation record changed: completed, the instance slot and pause cleared,
  and an audit event written. The instance was not restarted.
- CIS logged only the code, so which observation check failed is not known.

Cloud.3 was then admitted for the fleet in the same way. Instances with automatic
updates on move to it in their next maintenance window.
