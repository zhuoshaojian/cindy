# Managed cloud identity — 2026-10-27

## Delivery and scope

The fork's [delivery run 40438524225](https://github.com/zhuoshaojian/cindy/actions/runs/40438524225)
completed successfully in 15 minutes 44 seconds, including runner supply and
queue time. Recipe commit: `01d2825ad73e30254550c14ce04f23efb988d156`.

- Image: `cloud-runtime-cn:0.1.113-cloud.29-cn-amd64`.
- Manifest digest: `sha256:52d148317ddf23a24a4d567165430c36c9945ca3e78f7904ccfa748770c401b0`.
- Image config: `sha256:31d21053415b63411fa6bbe325c24f22efbeb27a9357bfd0394abe2140331551`.
- Frozen application source: `4eb73c7f68387b79ed91f788392f47709bd45baa`;
  upstream `0.1.113`: `cfb326662233d216f11eed2d494cc555254ac3b3`.
- Native x86_64 CI smoke passed: desktop, sandboxed renderers, old HOME
  permissions, Dock preferences protection, application version, isolated network,
  read-only root and clean shutdown. The two planned ACS caches were Ready.
- A disposable ACS probe then verified the exact cloud.29 main and init references
  actually used the new cache. It used emptyDir volumes and was removed.

CI published the image and prepared caches. The subsequent CIS admission and
upgrade were separate, explicitly authorized operations restricted to the owner's
instance. Neither new-claim defaults nor other instances were promoted.

## Real instance upgrade

The signed-in native Mac development client's **Update and maintenance → Upgrade
now** button submitted the upgrade outside the automatic maintenance window.
The normal CIS operation completed at **02:58:31 UTC**:

- cloud.28 stopped before the required encrypted OSS backup. The backup completed
  with 3,290 files and 439,658,669 ciphertext bytes before cloud.29 started.
- Main and all actual init containers use the manifest above and matched the
  prepared ACS cache. The replacement Pod is Ready with zero restarts. CIS reports
  `completed`, no active maintenance, and no further available upgrade.
- Application version reads `0.1.113-cloud.29`; auth, database, binaries, maker and
  DeviceLink readiness are healthy. The runtime reports maintenance released.
- Device/owner identity, PVC, resources and auto-update preference are preserved.
  Stable database/WAL copies pass `quick_check`; inspected session/message counts
  and schedule hashes match. This instance has zero schedule entries, so this is
  not a nonempty-schedule execution test. No new crash dump appeared.
- Inspected preference differences are confined to startup transition IDs and
  timestamps in skill-projection/worktree-audit records. No all-files byte-equality
  claim is made.
- Final readback confirms the other 11 instances' images, desired states,
  auto-update preferences, identities, StatefulSet specs, Pod UIDs and restart
  counts are unchanged. Stopped instances remain stopped. New-claim, backup and
  scheduling policies are unchanged.

## Logout and account mutation protection

The running cloud.29 application was inspected in the upgraded owner's instance:

- Settings still displays the current user and profile-edit control, but omits
  **Log out** and **Add account**. The home sidebar account menu contains only
  **Settings**, with no saved-account switcher. Screenshots were visually checked;
  account/task-bearing images remain private operational evidence.
- The real renderer preload IPC was invoked for logout, add account, switch to an
  unowned account, direct login dispatch and enter-local-mode. **All five were
  rejected**. Authentication remained valid, and owner, device, mode and saved
  accounts were unchanged after the calls.
- Logout, login dispatch and local mode return the managed-identity rejection.
  Add/switch are also rejected before mutation, but their existing IPC serializer
  maps the error to `[INTERNAL] Saved account operation failed`. This record does
  not claim those two expose the managed-identity error code.
- The diagnostic connection was loopback-only, temporary, and confirmed closed
  after each probe. No image flags, services, public debug ports or permanent
  runtime settings were changed. The original UI route was restored.

The same packaged binary also passed real-preload IPC checks in disposable native
Linux with synthetic identity and no real credentials, PVC or external network.
The first assertion compared the initial provider-discovery error response with
its settled flow projection, which differed even without an account mutation.
The corrected harness settles discovery first and then checks exact before/after
state; all five rejections and state preservation pass. Earlier failed records
are retained. All disposable lab Pods were removed.

Mac emulated-Linux startup was blocked by `INSTANCE_SECCOMP_UNAVAILABLE`; that
attempt is not counted as passing evidence. Seccomp was not disabled to make it
pass. The successful native lab loaded the shipped seccomp policy inside its
isolated user/network namespace.

## Other login methods and bridge coverage

CIS is running fork commit
[`99167ffbecec2a4f63a32bdb6949c45a33ed5383`](https://github.com/zhuoshaojian/cindy-server/commit/99167ffbecec2a4f63a32bdb6949c45a33ed5383),
delivered by [server run 40469189776](https://github.com/zhuoshaojian/cindy-server/actions/runs/40469189776).
The run completed successfully. A 07:57 UTC readback confirmed API and
orchestrator both use that release digest, with current observed generations and
all desired replicas updated, available and Ready. This CIS workflow does not
deploy auth-server or change business-instance images.

- Current CN Auth discovery reports **phone, WeChat and Apple** enabled; email and
  Google are disabled. Disabled methods must not be presented as available just
  because the bridge supports them.
- 94 targeted CIS tests pass across personal login, continuation routes, enterprise
  SSO, Auth client and hosted login UI. They cover phone/email code login,
  WeChat/Apple/Google PKCE callbacks, contact binding, exact owning membership and
  device checks, cancellation, expiry, revoked admission and secret-safe responses.
- 32 native-client onboarding tests pass, including server-issued attempt IDs,
  owner/window invalidation, cancelled/reopened attempts and initialization scope.
- These bridge tests use synthetic upstream responses and test credentials.
  They do **not** prove real SMS delivery or a completed WeChat/Apple/Google user
  authorization. The upgraded instance's existing enterprise session remains
  healthy; a new interactive enterprise SSO login was not forced.

On 2026-10-27 a dedicated personal test account completed real **local** SMS,
WeChat and Apple login in the isolated native Dev client. The required contact
binding was completed by the user. These are not cloud-device login results.

A time-bounded, exact-identity cloud grant was then approved. The native client
created a real remote continuation, but the user stopped this attempt to correct
its hosted-page UI. The attempt was canceled, the grant revoked, and the test
record set to stopped. Readback showed no runtime reference and no pending
credential deposit. No business cloud container was created for this attempt.

The replacement native flow reuses the actual client LoginPageView, including
SSO, manual enterprise ID, connection choice, contact binding and verification.
SMS uses the existing native Auth/CAPTCHA sender with CIS-only verification;
social/SSO opens the selected Auth method directly. The cloud target remains
visible and the local account is never switched. Main keeps the attempt secret.
CIS's additive prepare-code endpoint must deploy before the new client.

Client implementation:
[`bcbd97d84ccf7811bfa7b44b18c59392969133e1`](https://github.com/zhuoshaojian/cindy/commit/bcbd97d84ccf7811bfa7b44b18c59392969133e1)
on `feat/cloud-settings-native-client`. Client typecheck and 462 targeted tests
pass. CIS typecheck and its full suite pass (1,747 tests; 395 existing skips).
Native flow and renderer lifecycle tests cover direct provider dispatch,
SSO continuation, CAPTCHA failure/retry, binding, owner/window invalidation and
late cancellation. The shared login UI passed 10 Light/Dark scenarios and was
visually inspected. These UI scenarios use synthetic admission and IPC. The
broader changed-page scan also covers unrelated pages through shared locale
files; its pre-existing MCP-card fixture failure is not a cloud-login pass.

## Real remote login results and first-start failure

The isolated Mac Dev client was unlocked and its Keychain access authorized.
The user then completed all three real cloud-targeted login methods through the
shared native login UI. The local signed-in account stayed unchanged:

| Method | Real interaction | Remote result |
| --- | --- | --- |
| SMS | Native CAPTCHA/code delivery; user entered the received code | CIS attempt ready at 08:23:52 UTC; exact owner/device verified; credential handoff consumed. After waking the test instance, runtime auth was ready. |
| WeChat | Direct provider page; user scanned and approved | CIS attempt ready at 08:34:50 UTC; exact owner/device verified; credential handoff consumed while the instance remained stopped. |
| Apple | Direct provider page; user approved the previously linked account | CIS attempt ready at 08:36:52 UTC; exact owner/device verified; credential handoff consumed while the instance remained stopped. |

The previously completed local contact binding was reused; neither remote social
flow presented another phone-binding step. This does not waive binding for an
unbound account. Enterprise SSO remains available in the shared UI and covered by
the existing tests; no new real SSO login is claimed here.

To independently exercise each method, only the stopped, exact-identity test
record was marked as requiring login between methods. No pending attempt or
credential deposit existed at either transition. Its PVC and stored profile were
preserved. These were controlled reauthentication fixtures, not three independent
fresh-PVC deployments or a demonstration of naturally expired credentials.

**The full first cloud startup failed and is not accepted.** After SMS handoff,
cloud.29 reported auth/binaries/maker ready, but database and DeviceLink were not
ready. Migration `0034_add_chat_embedding_vec.sql` failed with
`no such module: vec0` and rolled back. The shipped Linux `vec0.so` is a 131-byte
Git LFS pointer, not ELF. Its pointer-content SHA-256 is
`17375560e213194a7e81d77ef363ed85f18a33e87021ad613f7d0a103d4af582`.
The frozen source instead pins a 159,816-byte ELF with SHA-256
`5923730861b86c707cca5602b5f91092f9e52a46706dbc6e269fd4bb9c4498e8`.
Read-only inspection of the same image in the already-upgraded owner instance
confirmed the packaged defect. That instance's existing database readiness does
not prove a fresh database can be created. The test log also contains a heartbeat
URL error (`/heartbeat`); it still needs a clean-start recheck after the database
blocker is removed.

The build recipe now normalizes Git archive LFS handling, resolves frozen objects
through Git LFS, checks exact size/SHA-256 and records their provenance. Missing,
skipped or corrupt downloads abort preparation. The packaged native probe now
loads the Linux extension, creates a fresh vec0 table and performs an insert and
nearest-vector query; publication requires the explicit `sqliteVec` result.
No migration is skipped, and no shipped image is patched in place.

Local verification of this correction:

- Exported the exact frozen commit: all five platform LFS objects match their
  recorded hashes/sizes; the Linux x64 payload is ELF.
- A fresh LFS object cache fetched the pinned Linux x64 object through the fork
  endpoint and matched its source hash. The checksum-pinned Git LFS installer also
  passed in disposable Linux; the existing runner image is not changed.
- The verified Linux payload loaded successfully (`v0.1.9`) in a disposable,
  network-disabled, read-only Docker Linux amd64 container under Apple Silicon
  emulation. Fresh vec0 creation, insert and nearest-vector lookup passed using
  Python SQLite. This is an extension check, not the packaged Electron ABI probe
  or a complete image startup.
- Source/build regressions: 32 passed; delivery regressions: 57 passed, including
  rejecting the old SQLite/PTY-only publication proof and failed vec checks.

The correction has not yet produced a new image: cloud.29's immutable tag remains
unchanged. The next image must pass its packaged Electron probe and a fresh-cloud
startup before that remaining acceptance item can be marked complete.

The temporary personal-account grant and invitation were removed from both CIS
roles within the original approved window. Both roles are Ready with no old
policy Pods. The test instance remains stopped; its PVC is retained as failure
evidence. There is no pending credential deposit. The healthy enterprise instance
was not logged out or rebound, and other instance images were not promoted.

This change controls the **Cindy instance identity**. Model-provider, plugin and
MCP third-party authorizations are separate and were not re-authorized in this
run. DeviceLink readiness is not a new cross-device input/clipboard test; previous
acceptance limitations remain unchanged. No main-branch merge or fleet promotion
is implied by this record.
