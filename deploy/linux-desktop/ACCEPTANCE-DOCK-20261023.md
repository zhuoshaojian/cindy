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

This proves image delivery and cache readiness. `podMatchVerified` and
`releaseApproved` remain false: actual instance cache-hit checks, CIS admission,
native-client upgrade and DeviceLink acceptance are separate. No cloud instance
was upgraded for this change during these checks, and no new-claim default changed.
