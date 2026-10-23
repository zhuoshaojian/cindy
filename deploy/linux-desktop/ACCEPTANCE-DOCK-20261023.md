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

Full native-amd64 image build, release smoke and ACS cache: pending the first run.
No cloud instance was upgraded for this change during local validation.
