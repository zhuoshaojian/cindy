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
`cloudParent`. Release identity: `0.1.128-cloud.1`.

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
