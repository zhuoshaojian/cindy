# Upstream 0.1.133 alignment

The cloud stack is rebased onto official `v0.1.133`
(`4a068d08cf9ea6633f6ee48cea800944bf70f746`, released 2026-11-11). The history stays
linear, with no merge commits, in the same order as the
[0.1.130 alignment](UPSTREAM-0130.md):

1. The generic seams for showing another computer's settings.
2. The generic fixes.
3. The cloud-only commits, the earlier adaptations and their releases through
   0.1.130-cloud.2, with the cloud web changes since then (CIS refusal messages,
   claiming another instance below the owner's limit, and the organization sign-in
   repair).
4. The v0.1.133 adaptation and this release.

The previous delivery head is kept as `backup/cloud-settings-native-client-0130`. The
source freeze names it as `cloudParent`. Release identity: `0.1.133-cloud.1`.

## Compatibility decisions

Upstream added 808 commits. Electron (42.11.12) is unchanged, and the local database
schema did not change between v0.1.130 and v0.1.133.

- **Per-platform assembly.** Device Link dispatch and its settings store are now
  per-platform factories. The cloud private-channel, provider-group and
  routing-projection helpers come from the dispatch factory and are imported from its
  desktop assembly; the Device Link settings inspection is built inside the store
  factory, where its defaults and file path now live.
- **Injected profile roots.** Upstream injects the userData and appData roots at
  startup instead of reading them from Electron. Production already sets both after
  every cloud profile path change; tests inject them as startup does.
- **Main-process translator.** The Host settings translator and locale come from
  `i18n.desktop`.
- **Grok sign-in.** The Grok browser sign-in passes the injected opener to the
  management authorization helper.
- **Default new-task folder.** Upstream's new General setting is a renderer-local
  value outside the v2 snapshot. The CIS catalog is unchanged.
- **Settings Skill for companions.** Host Skills, including the Cindy settings Skill,
  now follow upstream's isolated companion rule: an isolated companion profile skips
  them, and a companion with project context loads them.
- **GitHub connect.** On a cloud instance the device-code sign-in runs first; when it
  does not apply, upstream's own GitHub connect flow runs.

The CIS v2 settings contract and the web relay channel list are unchanged, so the web
pages built from 0.1.130 and 0.1.133 call the same Host channels and only those an
instance reports.

## Checks

These ran on a macOS checkout and are not real-account acceptance:

- Desktop type check: clean.
- Desktop tests for the cloud client, the web pages, Host settings, the cloud settings
  page and the shared contracts: 187 files and 2737 tests pass.
- `scripts/__tests__/restart-desktop-remote.test.mjs` ("whoami attributes a shared
  personal shell") fails identically on a clean `v0.1.133` checkout.

## Owner acceptance

The cloud.1 image (run `43148682944`) passed the native smoke test and reached the
image cache. A cache probe in the cluster matched the cache and read
`0.1.133-cloud.1` from the image's application archive. Only the owner's instance was
approved for cloud.1 and upgraded, with no hold. The final check found:

- Main and init images updated, a cache hit, a ready pod with no restarts, and
  maintenance released.
- 4186 backup files.
- Databases, sessions, messages and schedules unchanged; no schedule columns added.
- No endpoint write; the list is still the approved official one.
- Peer records and the defaults for new instances unchanged.

On the instance's desktop Cindy started signed in as `0.1.133-cloud.1`, with its
sessions and companions. The CIS web settings page, still serving the 0.1.130 web
build, read the instance version, Cindy AI quota, the provider shared to the owner and
the selected models from the 0.1.133 Host. Switching one model off and back on saved
through the Host both times.

The Dev client `0.1.133-dev.cloud.20261112.1` was built from the same delivery commit
and installed beside the production app, which is unchanged.
