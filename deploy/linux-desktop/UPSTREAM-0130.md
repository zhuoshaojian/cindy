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
