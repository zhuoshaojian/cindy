# Upstream 0.1.130 alignment

The cloud stack is rebased onto official `v0.1.130`
(`999f7b8b415b17d246acaed7fe07880439fcaf72`, released 2026-11-10). The history stays
linear, with no merge commits, in the same order as the
[0.1.128 alignment](UPSTREAM-0128.md):

1. The generic seams for showing another computer's settings.
2. The generic fixes: the Linux clipboard generation and the Telegram persona
   recovery.
3. The cloud-only commits, the 0.1.125, 0.1.126 and 0.1.128 adaptations and their
   releases through 0.1.128-cloud.5.
4. The v0.1.130 adaptation and this release.

The 0.1.128-cloud.5 history from before the rebase is kept as
`backup/cloud-settings-native-client-0128`. The source freeze names it as
`cloudParent`. Release identity: `0.1.130-cloud.1`.

## Compatibility decisions

Upstream added 1267 commits. Electron (42.11.12) is unchanged. The largest change
for the cloud stack is that the settings sections now use shared layout components
(`SettingsSection`, `SettingsCard`, `SettingsRow`, `SettingsField`). The cloud page
renders the same section views as the local page, so each view the cloud stack
splits out was rebuilt on the new layout with the same exported names and props.

- **New controls in shared views.** Upstream's macOS Dock icon row reads local-only
  state, so the appearance view shows it only when the local page passes it. The
  vision bridge's new collapse and the memory page's new tip and reset buttons are
  driven by the props the cloud page already passes.
- **Retired upstream features.** Upstream removed plugin shortcuts, plugin
  appearance fields and the Smart Contacts page. The Host write gates for shortcuts
  and appearance no longer accept the plugin entries; the cloud page no longer
  imports the contacts page.
- **New appearance and window fields.** The Host appearance validator accepts the new
  app icon and desktop wallpaper visibility; the window-behavior inspector validates
  the new away guard fields. Without this, saving the app icon on a local desktop
  would have been rejected by the cloud validator.
- **New IM channels.** Upstream added the official Feishu hook and iMessage defaults.
  The frozen CIS IM contract has no Feishu channel, so the cloud page's IM target
  rejects Feishu binding with a note to connect it on the instance. iMessage defaults
  are native-only leaves: the reader reports them and the v2 projection drops them,
  as it does for other leaves the frozen wire cannot carry (471 native, 453 v2).
- **About and prompt pages.** About rows now draw their own dividers, so the cloud
  About page no longer adds separate ones, and the cloud update overlay hides the
  auto-update row without a divider. Upstream moved the personalization title out of
  the prompt editor; the cloud page frames its editor in the same page section.
- **Skill links.** Upstream links Skills into Claude only where a Claude home exists.
  The cloud stack checks that home under the Cindy-managed home, as it does for the
  links themselves.
- **Older runtimes.** Upstream's price override view adds a currency list that a
  0.1.128 instance does not report; the dialog treats a missing list as one currency.
- **Account usage.** Upstream added an options argument to the account usage hook;
  the cloud reader is now its fifth argument.
- **Owner and profile seams.** Upstream now injects the userData folder at startup and
  resolves the active owner through a new owner-context module. Host settings tests
  set both the way upstream's own store tests do; production already sets the folder
  after every cloud profile path change.
- **Test setup.** Upstream's Electron stub imported a main-process worker module at
  load, which bound `node:os` before a test's own mocks applied. It now imports the
  worker on use, so tests that move the home directory see their own.
- **Search and typography checks.** The cloud prompt reset button names its search
  action, the shared settings sidebar drops upstream's removed plugin marker, and the
  web start-failure page spells out its font properties.

The CIS v2 settings contract is unchanged.

## Checks

These ran on a macOS checkout and are not real-account acceptance:

- Desktop, Mobile, `@cindy/mcps` and `maker-core` type checks: clean.
- Desktop tests: every test file touched by the cloud stack passes. The remaining
  failing files (git-integration suites, the database proxy timing test and the
  hosted Claude e2e) fail identically on a clean `v0.1.130` checkout in the same
  environment.
- Settings search coverage and i18n key checks pass.
- Recipe checks: node 123 passed, 18 skipped; all Python suites pass.
- `stage-cloud-overlays.mjs` applies all 30 overlays to the frozen source.

## Owner acceptance

Only the owner's instance was approved for and upgraded to `0.1.130-cloud.1`. Other
instances and the defaults for new instances are unchanged. The same upgrade also
moved the owner's endpoint list to the official CN list. CIS now rebases an
opted-in profile's list on the pinned official v0.1.130 CN list and keeps only
`cloudInstanceApiBaseUrl` and `region`. Only the owner's profile is opted in. The
change touched 13 fields, among them `chatApiBaseUrl`, `shareBaseUrl`,
`feishuHookWsUrl`, `webhookApiBaseUrl` and `review`.

The upgrade stopped twice before it completed. Both stops came from the
operator script that runs the upgrade, not from CIS or the image:

- The script's mutation allowlist lacked the fenced endpoint patch. The upgrade
  stopped in recovery-hold with the instance down. With the owner's consent it was
  rolled back to `0.1.128-cloud.5`. The template matched the source image and
  maintenance was released.
- The rerun stopped in recovery-hold with the candidate running. The script's
  candidate data check did not list two new empty schedule columns,
  `schedules.webhook_trigger` and `schedule_runs.trigger_source`. The owner chose to
  complete it: CIS's check ran again, then the instance was marked verified,
  released and finished without a restart.

The final check found:

- Main and init images updated, a cache hit, a ready pod with no restarts, and
  maintenance released.
- 4053 backup files.
- Databases, sessions, messages and schedules matching the sealed snapshot.
- The mounted endpoint list matching the approved official list.
- The 18 peer records and the defaults for new instances unchanged.

`CHAT_ENDPOINT_UNAVAILABLE` was logged once at each start on the old list and not
at all since the start on the official one. From the instance, the chat server's
`/v1/me` answers an unauthenticated probe with `401 AUTH_REQUIRED`.

## cloud.2: the cloud login window loads again

Upstream v0.1.130 subscribes every window's renderer to local theme changes. The
cloud login window preload exposed only `listSync`, so its entry failed with
`localThemes.onChanged is not a function`. The window stayed blank in the Dev client,
and the instance logged the same error when it prewarmed the window. The preload
now exposes `onChanged` like the other window preloads. A test checks every preload
that exposes local themes.

The cloud.2 image (run `42824961066`) passed the native smoke test and reached the
image cache. A cache probe in the cluster found the fix in the image's preload. Only
the owner's instance was approved for cloud.2 and upgraded, with no hold. The final
check found:

- Main and init images updated, a cache hit, a ready pod with no restarts, and
  maintenance released.
- 4152 backup files.
- Databases, sessions, messages and schedules unchanged.
- No endpoint write; the list is still the approved official one.
- Peer records and the defaults for new instances unchanged.

Since that start the instance has logged neither the login window error nor
`CHAT_ENDPOINT_UNAVAILABLE`.

The instance had no teammate of its own, so a temporary one was created in the
instance's Cindy and asked to call `get_teammate_home`. It returned `ok` with mode
`local` and the instance itself as home, instead of the earlier `NOT_ENABLED`. The
temporary teammate was then deleted; its archived task remains in history. The
Dev client `0.1.130-dev.cloud.20261110.2` shows the cloud login window again.

## Fleet rollout

On 2026-11-10, after the owner acceptance, the owner asked to push cloud.2 to the
other instances and to move their endpoint lists to the official CN list too. Running
work should skip an instance; scheduled runs that have not started should not.

The fleet policy:

- Approves cloud.2 for every organization instance and adds it to native admission.
- Moves the default image for new claims to cloud.2.
- Opts the nine running verified profiles into the official list.

Each instance's automatic update setting and maintenance window are unchanged.
CIS's default endpoint file, which new claims copy, now holds the official list with
the CIS address and region kept. New claims therefore start on cloud.2 with the same
list as upgraded instances.

The instances were upgraded one at a time, each with its own backup:

- Verified profiles changed their list in the same fenced transaction as the
  image.
- Native instances have no such step. Once a native upgrade completed and the
  instance was idle, its record was rebased the way the console edits endpoints, and
  CIS restarted it once.

Ten instances passed in the run: seven verified and three native. Two were skipped,
and one of them was finished afterwards:

- `liufangxing1` (`…49e6c469`) runs scheduled tasks every few minutes, and the run
  waited for a gap of 90 seconds. At the owner's request it was then launched as
  soon as nothing was running. It passed, and the user-level browser stopgap from
  cloud.5 was removed now that the image ships the default.
- `…94121710` (sunyi, 0.1.119-cloud.5) has been signed out and not ready since
  2026-11-10. Its runtime reports one unknown work item, so CIS will not seal it.
  CIS's upgrade also needs the source and the candidate to be ready, so even a
  direct upgrade would end in a hold. It was left unchanged, and the database
  copies taken for a direct upgrade were removed. It upgrades through the standard
  flow once sunyi signs in again.

The stopped instance `…250573f0` (manual updates) is untouched.

## Plugins on the remote plugin page (client only)

The cloud settings Plugins category used to offer only the instance's remote desktop.
Upstream has managed another computer's plugins and skills over DeviceLink since
v0.1.112, and an instance serves that like any other computer. The native client now
shows those two pages in the category, fixed to the instance (`98feb2f31a`). This
needs no CIS or image change. The browser build does not load the pages and keeps
the remote desktop entry.

Checked with the Dev client `0.1.130-dev.cloud.20261111.1` against the owner's
`0.1.130-cloud.2` instance:

- The category lists the instance's eight installed plugins and the market.
- XD Feishu's settings page opens in the client and shows the account connected on
  the instance.
- The Skills tab lists the instance's skills without leaving cloud settings.

Not exercised: connecting an account, saving a setting, enabling or installing a
plugin.

## Cloud settings page chrome (client and web)

Layout and button changes in the cloud settings panel (`0d60a5daa9`, `da295345c4`).
The local settings pages are not changed; where a cloud page reuses a local one, it
keeps the local look.

- The header and the category body say "loading" until the instance has been read,
  and "offline" only after that.
- Model providers and IM bots keep their place in the sidebar until the instance
  answers, and are dropped only if it does not offer them.
- One reload button, in the page header, reloads the open category. The IM, external
  tools and ticket-only provider sections offer a retry only after a failed read.
- The plugin target button names only the scope, since the page names the instance.
- Providers, Tools and the instance overview carry the page title of the local pages.
- The maintenance save row shows only while something is changed.

Not changed, because they already match the local page: the storage usage card and
the database card.

The web pages share the panel. CIS pins the build of `da295345c4`
(`cloud-web-da295345c4`, 39,826,288 bytes, cindy-server `e31e992a1`); the host call
contract is unchanged since the previous pin (`33f0c9ad7b`, 0.1.128 source).

Checks: desktop typecheck; 1,415 cloud settings, web, plugin and skill tests; the
web build against a mock CIS (no script errors); CIS typecheck and 1,873 tests. On
the deployed CIS both roles are Ready with no restarts and serve `da295345c4`. In a
signed-in browser against the owner's `0.1.130-cloud.2` instance the instance,
provider (quota, model list, shared provider), Tools and IM pages load with the new
layout.

The Dev client `0.1.130-dev.cloud.20261111.3` (built from `0d60a5daa9`) was then
checked against the same instance, all ten categories:

- On opening, the header and the body say "loading" until the instance has been
  read; provider and IM categories are in the sidebar from the first frame.
- One reload button in the header on every category except the instance overview
  and the plugin page; none inside the IM or Tools sections.
- The plugin target button reads "全局" only.
- Providers, Tools and the instance overview show the page title.
- The maintenance save row appears after toggling auto update and disappears after
  discarding; nothing was saved and the instance's setting is unchanged.

Not exercised: a failed read (the retry buttons), and an instance that does not
offer providers or IM.
