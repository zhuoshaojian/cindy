# Xfce / Plank cloud desktop

Desktop sources that `../assemble-runtime.py` installs into the cloud runtime image
during the [source build](../SOURCE-BUILD.md). Registry credentials, deployment
addresses, instance identities, profiles and backups are not part of this directory.

## Runtime composition

- `cindy-linux-desktop` is the image's PID 1 wrapper, installed as
  `/usr/local/bin/cindy-linux-desktop` and started by `cindy-seccomp`. It fails
  fast without unprivileged user namespaces, starts the session bus, the keyring
  (managed instances), Xvfb and `xfce-session`, waits for desktop readiness, then
  starts Cindy directly or through `profile-supervisor.mjs`. On stop it gives Cindy
  up to 45 s before stopping the session, Xvfb, keyring and bus. The image label
  `io.cindy.entrypoint-sha256` records its SHA-256. `../runtime-entrypoint/` holds
  an Openbox variant that is not installed.
- `application-watch` is the in-image liveness check for profile instances. Every
  30 s it checks that Cindy is still the profile supervisor's child; after three
  consecutive misses while the supervisor still runs, it exits and the wrapper
  stops the container so Kubernetes restarts it. The supervisor itself exits with
  Cindy, even when Cindy's background processes still hold its inherited pipes.
- `xfce-session` starts xfsettingsd, xfwm4, xfdesktop and Plank. It publishes the
  final DISPLAY to D-Bus activation and waits for the WM and Dock strut before
  signalling readiness. Plank is restarted at most three times per minute; any
  other desktop process exiting stops the session.
- `apply-appearance.py` selects packaged Arc and Papirus. `apply-dock.py` selects
  Plank Matte and the Xfce wallpaper, with desktop icons disabled. Each runs once
  per home (marker files in `~/.config/cindy-desktop/`) and preserves unrelated
  configuration.
- `apply-dock-apps.py` pins Terminal and Chrome using the system desktop files,
  never `~/.local/share/applications`, which can be root-owned in existing homes;
  no chmod/chown is needed. Existing pins are backed up, custom pins kept, and
  reruns are no-ops. It sets 40px icons without zoom unless the home already has
  the `plank-apps-v2` marker.
- `cindy-dock-chrome` starts Chrome with a separate personal profile, keeping its
  sandbox and the Secret Service password store. `cindy-dock-terminal` starts bash
  explicitly, because the account's passwd shell is noninteractive.
- `helpers.rc` and `cindy-cloud-chrome.helper.desktop` make that Chrome Xfce's
  preferred web browser, so links Cindy opens (plugin authorization, for example)
  land in the Dock's Chrome. A user's own `~/.config/xfce4/helpers.rc` still wins.
- [The cloud Plank patch](plank/README.md) hides the Preferences menu and disables
  its shared action, including CLI/D-Bus activation. Application menus and clock
  options remain available.
- `seccomp.json` is the allowlist `cindy-seccomp` loads at container start. It
  includes `close_range`, needed by GLib process spawning. Do not replace the
  profile with Unconfined. The launcher answers `clone3` and `faccessat2` with
  ENOSYS so libc falls back to allowed calls; under EPERM, glibc's `faccessat`
  fails and shell `test -x` / `-w` report false.
- `../runtime-window-controls/` keeps the Cindy main window open: minimization stays
  available, main-window closing is blocked, orderly shutdown is allowed. Plank's
  stock close menu can still appear; Cindy intercepts its request. Auxiliary and
  authorization windows close normally.

Xfce 4.18, Plank, xfce4-terminal, Chrome, the Arc and Papirus resources, X11 tools,
D-Bus and gnome-keyring come from [the dependency base](../runtime-base/README.md).

## Build metadata

`../build-image.py` reads only `clientRuntimeFixCommit` from `source-manifest.json`:
when `../source-freeze.json` lists `includedPatch` files, their bytes are taken from
that commit and must match the listed SHA-256. The build does not use the other
fields.

`Dockerfile.r5` is not part of the build. It layers the Dock launchers and
`apply-dock-apps.py` onto an existing runtime image passed as `BASE_RUNTIME_IMAGE`.

## Existing user launchers

A home can contain user-level `cindy-dock-terminal.desktop` and
`cindy-dock-chrome.desktop` entries in `~/.local/share/applications`. They take
precedence over the system launchers and cause duplicate Dock icons.
`retire-legacy-dock-entries.py` archives only entries whose entire content matches
the corresponding system launcher, into
`~/.config/cindy-desktop/legacy-user-desktop-entries/`. Custom entries and symlinks
stay; absent directories are not created and no ownership is changed.

The tool is not installed in the image and is not a login hook. Run it explicitly
as the desktop user with Terminal/Chrome windows closed, then restart the Dock and
verify launch/minimize/restore.

## Checks

- `application-watch.test.mjs` runs with the other `runtime-*/*.test.mjs` Node tests.
- `python3 test_retire_legacy_dock_entries.py` covers the launcher archive tool.
- `test-dock-migration.py` runs `apply-dock-apps.py` as UID/GID 10001 against a
  root-owned legacy `.local/share` in temporary homes with the keyfile GSettings
  backend, and checks that metadata and custom settings stay intact. Run it from
  this directory in an isolated container of the runtime image, without user homes,
  PVCs, credentials or network:

```sh
docker run --rm --platform linux/amd64 --network none --read-only --user 0 --tmpfs /tmp \
  --entrypoint python3 -v "$PWD:/source:ro" <runtime-image> /source/test-dock-migration.py
```

`../delivery/smoke.py` checks the packaged desktop in a container: desktop
readiness, sandboxed renderers, legacy-home permissions, shell access checks under
seccomp, Dock Preferences and the default browser.
