# Cloud Dock preferences — 2026-10-23

Target: `0.1.113-cloud.28`, built by the complete source Dockerfile and the fork's
`cloud-image-delivery` workflow. Deployment is a separate step.

## Local isolated check

Environment: Apple Silicon Mac, emulated Linux/amd64 container, Xvfb 1280×800,
synthetic user HOME, no user credentials or cloud PVC. This is not native-amd64
release evidence or DeviceLink end-to-end acceptance.

- Reproduced the stock Plank Preferences menu and working `--preferences` command.
- Built Plank 0.11.89 from checksum-pinned upstream and Debian source archives.
  The original exported ABI symbols are all retained.
- With the cloud patch, Ctrl+right-click omits Preferences. The running Dock's
  `preferences` GAction reports disabled; the CLI returns without opening a panel.
  The About action and clock menu remain available.
- Clicking Terminal launches it; minimizing reports X11 `Iconic`, clicking its
  Dock icon restores `Normal`. The original `lock-items=true` default is retained.
- Source/layer tests: 14 passed. Delivery tests: 54 passed. These run the real
  assembly and publication boundaries with synthetic artifacts; they do not
  replace the full-image native smoke.

The release smoke now exercises the running Dock action and CLI in the full image.
Publication requires `dockPreferencesHidden=true` along with the existing startup,
sandbox, old-home-permission, application-version and clean-shutdown checks.

## Delivery / production

The fork's [run 39908202230](https://github.com/zhuoshaojian/cindy/actions/runs/39908202230)
completed successfully on 2026-10-23 at 06:13:46 UTC. Recipe commit:
`3a496e9783fd425129361f014f2c802aa57661ac`.

- Image: `cloud-runtime-cn:0.1.113-cloud.28-cn-amd64`.
- Registry manifest: `sha256:d02e9195cecca7555ad19431374c05bdf3332ad52ebc866af4aa85eaaf40b3ec`.
- Tested image config: `sha256:fb31b8bc66bb7958e65598ac14676a55b1df20b5648f60c47f40d670abdc0559`.
- The native `x86_64` full-image smoke passed with `dockPreferencesHidden=true`,
  desktop ready, sandboxed renderers, legacy HOME permissions, application version
  `0.1.113-cloud.28`, isolated network, read-only root and clean shutdown.
- ACS cache plan: 2/2 Ready. The new runtime cache is
  `imc-uf64c6lm5ar3bhp8drpo`; the other receipt reuses the plan's explicit legacy
  init image cache. Main and init may both consume the new runtime reference.
  Receipts are in the run's `cloud-cache-39908202230-1` artifact.

This CI stage proves image delivery and cache readiness. Its immutable receipt
keeps `podMatchVerified` and `releaseApproved` false. The later own-instance
checks below are separate evidence; they do not rewrite the CI receipt or change
new-claim defaults.

## Own-instance upgrade

After delivery, a disposable ACS Pod with only emptyDir volumes confirmed actual
cache use for the runtime and both init patterns with the same cloud.28 digest.
The init commands and packaged application-version readback passed; the probe was
deleted. This is additional deployment preparation, not a change to the immutable
CI receipt or a test using a user's PVC.

Cloud.28 was then admitted only for the owner's verified profile. Before upgrade,
the live CIS response selected `0.1.113-cloud.28-cn-amd64` and reported
`updateAvailable=true`, `manualUpgrade=true`. The native Mac test client's real
**Upgrade now** button submitted the request outside the automatic maintenance
window. The normal CIS maintenance flow completed at 06:36:36 UTC, upgrading this
one instance from `0.1.113-cloud.9` to `0.1.113-cloud.28`.

- The source stopped before the required encrypted OSS backup. The backup
  completed with 3,285 files and 439,425,707 ciphertext bytes before the target
  started. No backup or observation gate was bypassed.
- Main and init use the cloud.28 digest above and actually matched
  `imc-uf64c6lm5ar3bhp8drpo`. The replacement Pod is Ready with zero restarts.
- CIS reports the user operation `completed`, no active maintenance operation,
  cloud.28 as the current image and `updateAvailable=false`.
- Application package version reads `0.1.113-cloud.28`. The running Plank library
  hash matches the tested CI artifact. Its Preferences action is disabled and
  `plank --preferences` creates no panel; About remains available. Clock,
  Terminal and Chrome pins are present, with 40px icons and `lock-items=true`.
- PVC, device identity, ownership, resource settings and auto-update preference
  are preserved. Stable copies of the database and WAL pass `quick_check`;
  inspected table counts and schedule hashes match before/after. The test
  instance had no scheduled entries, so this does not exercise a nonempty
  schedule through upgrade. No new crash dump appeared.
- Inspected preferences are unchanged except for startup timestamps and
  transition IDs in the skill-projection and worktree-audit records. This is not
  a claim of byte-for-byte equality for all user files.
- Final readback confirms the other 11 instances' images, desired states,
  auto-update choices, identities, StatefulSet specs, existing Pod UIDs and
  restart counts are unchanged. Stopped instances remain stopped. New-claim,
  backup and scheduling policies are unchanged.

The local pre-click heartbeat sample was too old to certify as fresh; the upgrade
was gated by CIS's own successful prepare/seal handshake. Do not count that local
pre-click sample as a passing readiness check.

## DeviceLink scope and remaining checks

The real Mac test client's remote desktop connected to the upgraded cloud
instance and displayed **Controlling / Direct connection**. Video, a mouse click
that focused a temporary Chrome textarea, ASCII typing and Backspace were checked
against the text actually received in the cloud window. This is separate from
the isolated Linux smoke above.

The full remote-input suite is **not passed**:

- Automated mixed Chinese/emoji/newline input produced extra `a` characters and
  lost the newline; automated Ctrl+A did not select all. Whether this originates
  in the Mac automation's generated key events or the viewer remains unresolved.
  Physical-keyboard input has not been checked in this run.
- Chrome launched by the test fixture displayed an additional running Dock icon
  alongside its pin. The pin and system desktop entry are correct, and the old
  user desktop-file overrides are absent. Launching from the actual Dock and
  verifying grouping/minimize/restore remain pending for this upgraded instance.
- OAuth, bidirectional clipboard and mobile hardware were not re-tested here.

The fixture's Chrome window and temporary page/log were removed without closing
unrelated applications. Upgrade and Dock-preferences checks passed; full product
acceptance remains partial. These checks alone do not authorize fleet promotion.

## Subsequent explicit admission

The owner subsequently requested making cloud.28 available to the other instances.
Both CIS roles now admit the exact same CI-delivered digest for the remaining
11 profiles, including their actual init templates; no new image was built for
this admission. No instance upgrade was requested or forced by this step.

Readback confirms ten other instances select cloud.28 with `updateAvailable=true`
and `manualUpgrade=true`. The remaining stopped instance has image/init approval
but is not enrolled in maintenance, so its existing API still reports no manual
upgrade; it remains stopped with auto-update disabled. The owner's instance is
already current. Eligible running instances are outside their maintenance window.
All 12 instance images, templates, identities and restart counts remain unchanged
by this policy update; backup, schedules and per-instance update choices are kept.

New claims select cloud.28 through the existing highest-admitted-version rule
(maintenance and Keyring approval intersection). The configured fallback images
were not rewritten. CI delivery still does not itself grant CIS admission; the
explicit policy change is separate from run `39908202230`. The partial DeviceLink
results above remain partial after admission.

## Native Mac client refresh

The sidebar cloud-settings shortcut now stays hidden at rest and appears on the
device row's hover or keyboard focus. It uses the same 24px button size as the
adjacent remote-desktop action. Routing and the selected cloud device are unchanged.

- Client source: `ca20bdcd887f52a8ee29f639c58ef13d28aa6338`.
- Dev package: `Cindy-Cloud-Dev-CN-0.1.113-dev.cloud.20261023.1-arm64.dmg`
  (265,667,462 bytes), built from a clean source export with the package-version
  transform recorded separately. This is an Apple Silicon Mac client package,
  not another cloud-runtime image.
- DMG SHA-256:
  `6907e322bdb588d1b1d742541f57f4eb257e59b6026fe2af713a5a1d4d6a4a00`.
- Desktop typecheck passed, as did 35 targeted entry/device-header tests and
  10 Dev distribution/coexistence tests. The real shortcut component passed
  light/dark isolated UI checks for rest, hover, keyboard focus, blur and 24px
  dimensions; this fixture did not connect to cloud RPC.
- The wider changed-UI run passed 86/88 checks. Two existing MCP-card scenarios
  failed on an SVG `width`/`height` value of `sm`; those unrelated cards were not
  changed. The shortcut was uncovered by that runner, hence the dedicated checks.
- The packaged renderer contains the hover/focus change. Package version,
  source identity, arm64 executable, Dev descriptor and helper bundle identities
  were checked. The existing `com.xd.cindycn.clouddev` identity and Dev profile are
  retained, with no production URL/document handlers registered by this package.
- Ad-hoc signing and strict deep signature verification passed. The DMG checksum,
  read-only mount, mounted application's signature and application payload hash
  also passed. The package is not Apple-notarized.

The new package was not installed or launched during this refresh; current client
installations and data were left untouched. These package/UI checks do not close
the remaining cloud DeviceLink checks above. Client renderer changes and this
record do not match the cloud-image delivery workflow's push paths.
