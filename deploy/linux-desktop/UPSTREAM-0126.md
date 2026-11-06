# Upstream 0.1.126 alignment

The cloud stack is rebased onto official `v0.1.126`
(`5ab30ec856e57e2ae8944657e9e2d69264c672f5`, released 2026-11-04). The history stays
linear, with no merge commits, in the same order as the
[0.1.125 alignment](UPSTREAM-0125.md):

1. The generic seams for showing another computer's settings.
2. The generic fixes: the Linux clipboard generation and the Telegram persona
   recovery.
3. The cloud-only commits, the 0.1.125 adaptation and the 0.1.125 releases through
   cloud.3.
4. The v0.1.126 adaptation and this release.

The 0.1.125-cloud.3 history from before the rebase is kept as
`backup/cloud-settings-native-client-0125`. The source freeze names it as
`cloudParent`. Release identity: `0.1.126-cloud.2`.

## Compatibility decisions

Upstream added 317 commits. Electron (42.11.12), the dependency lockfile and the
database migrations are unchanged.

- **Settings tools.** Upstream added its own settings tools (`list_app_settings`,
  `get_app_settings`, `update_app_settings`, `reset_app_settings`, and the default
  model tools) in the `cindy_helper` `settings` category. The Host settings tools
  used the same category.
  - The Host settings tools (`list_settings`, `get_settings`, `update_settings`,
    `get_settings_operation`) now have their own `host_settings` category, with the
    same gating, the same native-subagent denial and the same human confirmation.
  - Upstream's `settings` category keeps its default visibility and its rule that a
    remote task cannot see it.
  - The `cindy-settings` Skill discovers `host_settings`. Its text is version 2.
    Cloud.1 changed the text but kept version 1, and an installed copy keeps its
    text under an unchanged version, so instances kept pointing at `settings`.
    Cloud.2 raises the version, and a test now ties the version to the text.
  - On an instance, a local task can now also use upstream's tools, which change
    settings directly, as on any desktop. Host settings writes still need the Host
    confirmation.
- **Preference changes on an instance.** Upstream's preference section confirms a
  change by reading the window's local storage. On an instance the Host profile
  holds these preferences and its writes are asynchronous. There, the check waits
  for the Host receipt and compares the confirmed values. File browser and home
  dashboard preferences are not Host-owned and keep the upstream check.
- **Setup migration.** Upstream's new section for moving a setup from another
  computer is listed as a dedicated action in the client's coverage. The CIS v2
  catalog is unchanged.
- **Model interface edits.** As in upstream, choosing Messages for a Pi model on a
  compatible runtime keeps the runtime endpoint instead of generating a route. The
  shared model edit used by the cloud page follows this.

The upgrade operator's data checks need no change: there are no new tables, columns
or schedule fields.

## Checks

These ran on a macOS checkout and are not real-account acceptance:

- Desktop, Mobile, `@cindy/mcps` and `maker-core` type checks: clean.
- Desktop tests: every test file touched by the cloud stack passes. The remaining
  18 failing files (git-integration suites, local-database suites and a hosted
  Claude e2e) fail identically on a clean `v0.1.126` checkout in the same
  environment. Under full-suite load, the hosted Codex e2e and the bot-import source
  test each failed once on a timeout or temporary-directory cleanup. Both pass on
  their own.
- `@cindy/mcps` and the Claude Code `maker-core` suites pass.
- Recipe checks: node 140 passed, 1 skipped; all Python suites pass.
- `stage-cloud-overlays.mjs` applies all 30 overlays to the frozen source.

## Owner acceptance

Only the owner's instance was upgraded. It was idle both times, so neither upgrade
was skipped; the operator now checks once instead of waiting for work to finish.
Other instances, the cloud.3 fleet admission and the defaults for new instances are
unchanged.

**cloud.1** (`58dfdc642c`) completed with an encrypted backup, unchanged databases
and schedules, and peer records unchanged. Reading the instance afterwards showed
the `cindy-settings` Skill still on its version 1 text, which points at `settings`.

**cloud.2** (`1d222ddc26`) passed the same checks, and the instance Skill now
discovers `host_settings`. Preparing its policy also retired the unreferenced
`0.1.121-cloud.1` approval; no instance's update or new-claim selection changed.
The Dev client `0.1.126-dev.cloud.20261106.2` was used against the real instance:

- The cloud page loads all ten tabs and reports `0.1.126-cloud.2`.
- The language menu lists all twelve languages. Saving Deutsch reached the instance
  (`de`), and the instance is back to 简体中文 (`zh-CN`).
- The model panel's advanced drawer opens on the instance, and its image-input row
  reads from the model catalog.
- With cloud.1, the remote desktop showed live video and the instance version.
  Upstream's new setup migration prompt appeared only in the Dev client's own
  window, not on the instance desktop.

Not checked live: upstream's `update_app_settings` preference path on an instance
(the Host receipt check is covered by tests).
