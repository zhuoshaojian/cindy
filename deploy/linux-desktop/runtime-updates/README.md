# Cloud-managed application updates

Cloud packaging overlay. CIS owns application upgrades on cloud instances, so the
desktop updater stays inactive there. Native desktop source and ordinary builds
remain unchanged. Runtime activation additionally requires Linux and a valid
instance configuration.

The overlay suppresses the desktop updater's startup/background checks,
staged-patch restoration, installer/relaunch paths, update-channel relaunch and
automatic beta enrollment. The cloud main window shows neither the automatic
release-notes dialog nor the desktop auto-update preference. The static
settings-search catalog also omits that preference, including its deep-link
aliases, in every language. Manual release history and agent/plugin updates are not
affected. No environment variables, stored preferences or wire protocol are added.

The renderer flag comes from the `--cindy-cloud-main-window` argument added by
`runtime-window-controls`, so both overlays must be applied; `stage-cloud-overlays.mjs`
applies both. Every source anchor is checked; drift fails the build.

```sh
CLOUD_UPDATE_TEST_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-updates/overlay.test.mjs
```
