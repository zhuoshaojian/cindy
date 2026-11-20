# Cloud main-window controls

Cloud packaging overlay that keeps the Cindy main window available on Linux cloud
instances. It hides the close button and blocks main-window close IPC and
window-manager close events. Minimize, restore from the Dock, maximize and orderly
shutdown remain available; restoring a minimized window relies on the Dock. Browser
authorization windows and auxiliary Cindy windows are untouched.

Main-process decisions use the existing instance configuration. The main window
receives the `--cindy-cloud-main-window` argument, from which its preload exposes a
presentation-only flag; `runtime-updates` and `runtime-identity` reuse that
argument. There is no new environment variable, remote protocol, credential or data
change.

`stage-cloud-overlays.mjs` applies the transform to the build's source export;
`cloudMainWindowControlsPlugin({ sourceRoot })` is the Vite plugin form. The native
client checkout is never written, and ordinary client builds do not import this
directory. Each integration point must match exactly once; source drift stops the
build instead of shipping a partial patch.

```sh
CLOUD_WINDOW_TEST_SOURCE=/absolute/path/to/client node --test deploy/linux-desktop/runtime-window-controls/overlay.test.mjs
```

Without `CLOUD_WINDOW_TEST_SOURCE` only the policy tests run; with it, every
transformed integration point is also compiled and the window controls are rendered.
