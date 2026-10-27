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
[`72be526f0f26d108fc271dc281d2152fd4edf0a8`](https://github.com/zhuoshaojian/cindy-server/commit/72be526f0f26d108fc271dc281d2152fd4edf0a8),
delivered by [server run 40318433178](https://github.com/zhuoshaojian/cindy-server/actions/runs/40318433178).
This CIS workflow does not deploy auth-server.

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

Validation: CIS typecheck and its full suite pass (1,747 tests; 395 existing
skips). Native flow and renderer lifecycle tests cover direct provider dispatch,
SSO continuation, CAPTCHA failure/retry, binding, owner/window invalidation and
late cancellation. The shared login UI passed 10 Light/Dark scenarios and was
visually inspected. These UI scenarios use synthetic admission and IPC. The
broader changed-page scan also covers unrelated pages through shared locale
files; its pre-existing MCP-card fixture failure is not a cloud-login pass.

**Real remote SMS, WeChat and Apple completion and cloud startup remain pending.**
The healthy enterprise instance was not logged out or rebound for this UI work.

This change controls the **Cindy instance identity**. Model-provider, plugin and
MCP third-party authorizations are separate and were not re-authorized in this
run. DeviceLink readiness is not a new cross-device input/clipboard test; previous
acceptance limitations remain unchanged. No main-branch merge or fleet promotion
is implied by this record.
