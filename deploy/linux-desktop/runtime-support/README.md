# Runtime programs

Cindy-owned helper programs that `../assemble-runtime.py` installs into the
application layer:

| Source | Installed as | Purpose |
| --- | --- | --- |
| `seccomp-launch.py` | `/usr/local/bin/cindy-seccomp` | Image entrypoint. Requires UID 10001 without effective capabilities, loads `/usr/local/lib/cindy/seccomp.json`, then execs its argument |
| `healthcheck.mjs` | `/usr/local/bin/cindy-cloud-healthcheck.mjs` | Health probe (below) |
| `profile-helper-entrypoint.sh`, `profile-preflight-entrypoint.sh` | `/usr/local/bin/cindy-profile-maintenance`, `/usr/local/bin/cindy-profile-preflight` | Run `profile-helper.mjs` / `profile-preflight.mjs` under `cindy-seccomp` |
| `keyring-check.mjs` | `/usr/local/lib/cindy/` | Validates the mounted keyring secret before the PID 1 wrapper unlocks gnome-keyring |
| `profile-entry-check.mjs` | `/usr/local/lib/cindy/` | Tells the PID 1 wrapper whether to start Cindy through `profile-supervisor.mjs` |
| `profile-helper.mjs`, `profile-preflight.mjs`, `cdp-pipe.mjs` | `/usr/local/lib/cindy/` | Profile maintenance and preflight commands; CDP over inherited pipes, never a socket |
| `child-exit.mjs` | `/usr/local/lib/cindy/` | Lets `profile-supervisor.mjs` exit with Cindy even when Cindy's background processes hold its inherited pipes |
| `chromium-compat` | `/usr/bin/chromium` | Forwards unchanged arguments to Google Chrome |

`profile-maintenance-context.mjs` and `profile-runtime-wire.mjs` are bundled from
the frozen client source by `../build-runtime.sh`. No earlier Cindy image supplies
executable build inputs.

## chromium-compat

The slim dependency base removes the duplicate Chromium packages. `chromium-compat`
keeps `/usr/bin/chromium` for the frozen authorization browser/CDP code and forwards
its unchanged arguments to the pinned Google Chrome. Sandbox flags, private
debugging pipes and authorization cleanup are unchanged.

## Healthcheck

The healthcheck reads `CINDY_CLOUD_STATUS_FILE` and requires a status for
`CINDY_POD_DEVICE_ID` with a heartbeat at most 30 s old.

- No argument: phase `ready` and all five components (`auth`, `database`,
  `binaries`, `maker`, `deviceLink`) ready.
- `--startup` (startup probe): also accepts phase `starting` with `binaries` and
  `maker` ready, explicit auth recovery `login-required` or `pending`, and a live
  owner-only recovery socket. It does not make readiness pass or grant access
  before login.

Missing or stale status, stopping processes, broken initialization and missing or
unsafe recovery sockets fail both modes.

```sh
node --test deploy/linux-desktop/runtime-support/*.test.mjs
```
