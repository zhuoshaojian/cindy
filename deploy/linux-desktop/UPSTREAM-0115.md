# Upstream 0.1.115 alignment

The cloud client fork now contains the complete official `v0.1.115` release
(`6e12261af3121a1fc8f56a23481f3b99bb32787c`), merged into
[`feat/cloud-settings-native-client`](https://github.com/zhuoshaojian/cindy/tree/feat/cloud-settings-native-client).
The upstream repository's default branch is unchanged.

## Compatibility decisions

- Keep the fork's Host-owned, account-scoped model preferences and favorites.
  Support upstream's `ultrafast` value in durable history, remote preferences and
  favorite identity; do not collapse it into ordinary Fast.
- Carry `taskProviderId` through the remote preference writer. Changing a model
  inside an existing task must not move the new-task default to another source.
- Preserve cloud permission refresh after account switching, nonmodal login
  windows, managed-instance identity restrictions, native remote input and relay
  recovery, and the isolated Dev application's identities and storage.
- Keep the deployed CIS snapshot schema. Its boolean Fast fields describe whether
  Fast is enabled; exact tier selection belongs to the newer native protocol.
  A legacy cloud favorites round-trip retains an existing enabled ultrafast tier.
- Regenerate the inline remote viewer from the merged source instead of selecting
  either side's generated bundle. Keep upstream's new protocol compatibility notes.

## Local checks (2026-10-28)

Run against the merged checkout on macOS; test credentials and databases are
fixtures. These results do not claim real OAuth or DeviceLink end-to-end acceptance.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed, lockfile unchanged |
| Desktop typecheck; maker-shared and device-link `build` (`tsc --noEmit`) | Passed |
| Cloud settings, authorization, Host preference and conflict-area regressions | 1,312 passed; 2 native-only tests skipped |
| Main IPC, remote desktop, Dev isolation, renderer preference and migration replay | 8,098 passed; 6 environment-specific tests skipped |
| maker-shared | 1,797 passed |
| device-link | 1,024 passed |
| Additional legacy Fast wire/round-trip tests | 36 passed, including 2 new cases |
| Cloud overlay/source tests with all source environment variables set | 121 passed; 1 Bash-version-dependent test skipped |
| Source build Python tests / delivery Python tests | 32 / 57 passed |

The targeted ESLint check retains existing diagnostics from the fork/upstream
parents; new merge-specific diagnostics are resolved. No lint rule or test gate
is disabled. The 15 database migration replay cases passed using disposable test
databases; no user database was opened for migration.

## Delivery boundary

The cloud release identity is selected by `delivery/version.json` and
`source-freeze.json`. Advancing from 0.1.113 resets the cloud revision to
`0.1.115-cloud.1`; the application version, image labels and delivery record must
agree. The new freeze contains the earlier input-overload fix directly, so no
single-file replacement from an older source tree is required.

A source merge or successful CI image build is not instance qualification. This
alignment does not alter CIS approvals, new-instance defaults or existing cloud
instances. Linux image startup acceptance and a separately authorized instance
upgrade remain distinct evidence.
