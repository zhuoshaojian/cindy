# Upstream 0.1.119 alignment

The cloud fork integrates official `v0.1.119`
(`0694ed7e001e027a031ffed21a088bd1975132de`) on
[`feat/cloud-settings-native-client`](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client).
Neither repository's default branch is changed. Release identity is
`0.1.119-cloud.2`; delivery and owner-only acceptance must finish before wider admission.

## Compatibility decisions

- Resolve 38 conflicted files individually, retaining cloud permission refresh,
  account isolation, independent login windows, managed identity restrictions,
  Host-owned preferences, native desktop input and per-device recovery.
- Persist cross-engine thinking selections through the owner-fenced Host writer
  before bootstrap, without relying on a renderer acknowledgment.
- Add upstream terminal appearance fields to the local persistence validator;
  explicit resets clear overrides. The deployed CIS snapshot field set is unchanged.
- Preserve upstream business-ownership prompts and turn descriptions while adapting
  cloud overlay anchors. Missing or duplicate anchors still fail the build.
- Regenerate remote viewer and direct-link embedded sources from the merged code.
- Retain all upstream SQLite migrations; validate both the immutable history and
  replay in disposable databases before touching the owner instance.

## Local verification (2026-10-29)

These are macOS checkout tests with disposable fixtures, not real OAuth or
DeviceLink end-to-end acceptance.

| Check | Result |
| --- | --- |
| Frozen dependency install | Passed |
| Desktop and Mobile typechecks | Passed |
| maker-shared, maker-core, MCP and device-link TypeScript builds | Passed |
| Login, Host preferences, model picker and merged-settings tests | 1,488 passed; 2 native-only cases skipped |
| Cloud settings, authorization and remote desktop | 1,249 passed; 6 environment-specific cases skipped |
| maker-shared | 1,949 passed |
| Pi skill selection | 14 passed |
| Database validation / migration replay | Passed / 20 passed |
| Cloud recipe Node tests | 135 passed; Bash-version-dependent test skipped locally |
| Full cloud overlay staging | Passed; 29 records |

The first delivery (`cloud.1`, run
[40732826735](https://github.com/zhuoshaojian/cindy/actions/runs/40732826735))
stopped at production bundling: Node exhausted the old 6 GiB heap limit. It did
not publish an image or change any instance. `cloud.2` raises only the packaging
process limit to 12 GiB inside the existing 28 GiB build container; dependency
preparation and runtime resource limits are unchanged.

Delivery, exact cache-hit and owner-upgrade evidence will be appended after those
steps actually complete. Other instances remain outside this validation stage.
The automation proposal is [UPSTREAM-ALIGNMENT.md](UPSTREAM-ALIGNMENT.md).
