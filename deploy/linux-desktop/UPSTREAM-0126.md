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
`cloudParent`. Release identity: `0.1.126-cloud.4`.

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
  catalog is unchanged. From cloud.3:
  - An instance does not offer the migration by itself. A freshly claimed instance
    always looks new to upstream, but it is set up by its provisioning. Settings
    still opens the migration assistant.
  - Interface preferences and the personal prompt that the instance keeps in its
    Host profile move through the Host in both directions, in upstream's key
    format. Before, migrating into an instance reported them as done without
    applying them, and migrating out of one sent only the cached startup keys.
  - Upstream's offer on another computer to migrate *from* an instance is the
    official client's own behaviour and is unchanged.
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

## Fleet rollout of cloud.2

On 2026-11-06 the owner admitted cloud.2 for every organization instance, with new
instances defaulting to it. It replaced the cloud.3 (0.1.125) rollout planned for
that night: the ten running instances with automatic updates on move straight from
0.1.125-cloud.2 to 0.1.126-cloud.2 in their 03:00–05:00 window. No instance was
upgraded by hand. The stopped instance with automatic updates on moves when it next
runs; the other stopped instances and the personal instance are unchanged.

## cloud.3: setup migration on an instance

A read-only review of the new-claim flow found no blocking problem: claim image
selection, the pod template, a fresh profile's first start (CI native smoke), the
login bridge and the settings Skill are unaffected. It did find that upstream's setup
migration misbehaves on an instance, which cloud.3 (`feb049adc9`) fixes as two
cloud-only commits after the 0.1.126 adaptation (see Compatibility decisions).
Upstream files only gain a switch; the instance behaviour lives in
`state/hostDesktop/setupMigrationPrefs.ts`.

Only the owner's instance was upgraded. It was idle, so the upgrade was not
skipped. It passed the same checks as cloud.2. Its policy also retired the
unreferenced `0.1.121-cloud.6` approval; the cloud.2 fleet admission and new-claim
defaults are unchanged.

The owner set a temporary instance prompt and then previewed a migration from the
instance on the Dev client:

- On cloud.2 the preview carried only the cached theme and language. The prompt
  was missing.
- On cloud.3 it also carried the instance prompt, from the Host and under the
  account's key.
- The prompt was then reset; the instance has no custom prompt again, and the
  preview no longer carries one.

The cloud page loads all ten tabs and reports `0.1.126-cloud.3`. Migrating *into* an
instance and the missing automatic offer are covered by tests only: the owner's
instance does not look new, and a migration into it would change its settings.

## cloud.4: instance names

An instance's default name used CIS `nameSequence`, the account's count of every
instance it has claimed. The count never goes down after a deletion, so an account's
only instance could be called 「云端 Cindy 15」, and a fresh claim after deleted test
instances 「云端 Cindy 4」.

Cloud.4 (`043c464cd6`, one cloud-only commit) numbers an instance by its place among
the account's current instances, in claim order:

- A sole instance has no number, like its device name.
- Several instances are numbered 1, 2, …, and the numbers close up after a deletion.
- A name the user set is kept.

Main computes the place from the CIS instance list. CIS data, `nameSequence` and the
runtime device name are unchanged. The client's instance cards, login window, sidebar,
settings header and remote desktop title use the new name, and so does the instance's
own sidebar from this image on.
