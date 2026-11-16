# Openbox runtime entrypoint

`cindy-linux-desktop` here is the Openbox variant of the cloud PID 1 wrapper. It is
not installed in the image: `../assemble-runtime.py` installs
`../runtime-desktop-xfce/cindy-linux-desktop` as `/usr/local/bin/cindy-linux-desktop`.
This variant starts the session bus, the keyring (managed instances), Xvfb and
Openbox, then the application directly or through `profile-supervisor.mjs`. It is
kept with the shutdown-order test below.

## Shutdown order

Both wrappers use the same `cleanup`:

1. TERM to the application; wait up to 45 s (Pod grace period is 60 s), then KILL.
2. Only then stop the window manager, Xvfb, the keyring and the bus, up to 5 s each.

The application needs its display, bus and keyring while it runs its quit chain.
An orderly maintenance stop must leave
`/var/lib/cindy/user-data/.cis-maintenance/shutdown.json` (see `../runtime-maintenance/`).

## Tests

`shutdown-order.test.sh <wrapper>` replaces the dependencies with stubs and asserts
the order. It stubs `openbox`, so `entrypoint.test.mjs` runs it against this file;
keep `cleanup` identical in both wrappers. It needs Bash >= 5.1 and Python 3 and is
skipped otherwise:

```sh
node --test deploy/linux-desktop/runtime-entrypoint/entrypoint.test.mjs
```
