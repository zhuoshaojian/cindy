# Upstream 0.1.136 alignment

The cloud stack moves onto official `v0.1.136`
(`7227e8311a2d782f399323b21483c072fb1353b8`, released 2026-11-12). The history stays
linear, with no merge commits:

1. The generic seams for showing another computer's settings, each rebased on its own.
2. The generic fixes, each rebased on its own.
3. One commit with the cloud-only work through 0.1.133 cloud.8 and the settings cleanup
   that followed it. Moving the cloud history commit by commit would have resolved the
   same conflicts in the same files many times over, so it is squashed once, as the
   0.1.121 move did. The per-commit history is kept as
   `backup/cloud-settings-native-client-0133`, which the source freeze names as
   `cloudParent`.
4. The v0.1.136 adaptation and this release. Release identity: `0.1.136-cloud.1`.

## Compatibility decisions

Upstream added 860 commits. Electron is unchanged. The local database gains one table,
`mcp_app_view_states` (per-card MCP app view state). The change only adds a table, so an
instance rolled back to 0.1.133 leaves it unused.

- **Browser runtime factories.** The browser settings store and the browser runtime are
  now factories assembled in `*.desktop.ts`. The Host settings inspection, the store
  handle and the browser kind commit come back from the factories and are imported from
  the desktop assemblies.
- **Global teammate model chain.** Upstream removed the editor for the global default
  teammate model chain; per-teammate chains and the saved value stay. The cloud page
  drops its copy of that editor, the Host reports the `botModelChain` group as
  unavailable and refuses writes to it, and Agents no longer see it as a settings
  section. The read-only snapshot still reports the saved chain, so the CIS v2 snapshot
  contract is unchanged.
- **Plugin settings pages.** The settings sidebar keeps the cloud page's leading and
  trailing categories and adds upstream's plugin pages; search covers the plugin pages
  and still applies the cloud page's filter.
- **New settings categories.** Upstream's Model groups category and the get-started guide
  row are classified in the read catalog as a provider resource and a window action.
  Neither is a v2 snapshot field.
- **Feishu accounts.** Upstream's per-account Feishu binding, cancel and start calls go
  through the settings target, so the cloud page acts on the instance.
- **Preferences.** Upstream now prepares a theme change before applying the other
  preference fields; the cloud-added preferences (sidebar style, Feishu alerts,
  activation click, network diagnostics) apply with those fields.
- **Settings files.** The shared settings file helper follows upstream's file identity
  cache; the cloud change notification is unchanged.
- **Wording.** Upstream's English text now says "buddy" for teammates. No cloud-added
  string used the old word.

The web relay channel list is unchanged, and the only change to the settings groups a
web page reads is the retired teammate model chain, which an earlier web build shows as
unavailable.

## Checks

These ran on a macOS checkout and are not real-account acceptance:

- Desktop type check: clean.
- Desktop tests for the cloud client, the web pages, Host settings, the cloud settings
  page, settings components, bots, new-task drafts, main-process tests and the shared
  contracts: 1240 files and 20576 tests pass.
- `packages/browser-control-runtime`: 226 tests pass. Delivery script tests: 7 Node and
  33 Python tests pass.
- The runtime wire bundle and the web cloud pages build.
