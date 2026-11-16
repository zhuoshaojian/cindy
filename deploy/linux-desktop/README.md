# Linux cloud runtime image

This directory builds the Linux runtime image for cloud Cindy instances: cloud-only
build overlays, runtime programs, the Xfce/Plank desktop, build scripts and the
delivery pipeline. Ordinary desktop builds do not use anything here.

The client repository builds, smoke-tests and publishes candidate images and prepares
their ACS image caches. CIS (`cloud-instance-server` in `cindy-server`) selects
approved images and runs backups, upgrades and recovery on instances; it does not
build images or create their caches. Credentials, instance and PVC identities,
deployment configuration and backups stay out of both repositories.

## Documents

- [SOURCE-BUILD.md](SOURCE-BUILD.md): build the image from source, image layout, runtime acceptance.
- [delivery/README.md](delivery/README.md): the CI pipeline (verify, build, smoke, publish, ACS cache).
- [delivery/BOOTSTRAP.md](delivery/BOOTSTRAP.md): one-time setup of Environments, registries, ACS and runners.
- [delivery/runner/README.md](delivery/runner/README.md): one-job runners and the controller that provisions them.
- [DUAL-VERSION-UPDATES.md](DUAL-VERSION-UPDATES.md): upstream version plus cloud revision.
- [UPSTREAM-ALIGNMENT.md](UPSTREAM-ALIGNMENT.md): moving the cloud stack onto a new upstream release.
- [PROFILE-OBSERVATION.md](PROFILE-OBSERVATION.md): profile supervisor and runtime health evidence.

## Files

| Path | Purpose |
| --- | --- |
| `source-freeze.json` | Application commit, upstream tag and base-recipe commit to build from |
| `delivery/version.json` | Upstream version and commit, cloud revision |
| `Dockerfile`, `Dockerfile.dockerignore` | Application build stages and the runtime image |
| [`runtime-base/`](runtime-base/README.md) | Pinned third-party dependency base; no Cindy files |
| `build-image.py` | Export source and recipe from Git and build the image locally |
| `download-build-assets.mjs`, `prepare-codex.mjs`, `prepare-other-assets.mjs`, `prepare-linux.sh` | Download and verify pinned build assets; prepare the Linux builder |
| `prime-native-cache.cjs`, `verify-native-modules.cjs` | Prebuild native modules; run the packaged SQLite, sqlite-vec and PTY modules |
| `stage-cloud-overlays.mjs`, `build-version.mjs`, `build-runtime.sh` | Apply the cloud overlays and cloud version to the exported source, then package |
| `stage-runtime-agents.py` | Bundle the pinned Claude and Codex CLIs |
| `assemble-runtime.py`, `normalize-timestamps.py`, `audit-runtime-layer.py` | Assemble the application layer, clamp timestamps, audit permissions and links |
| `release_guard.py` | Image checks: platform, user, start command, labels, two-layer layout |
| `compact-runtime.py` | Optional repackaging of an existing image; see [SOURCE-BUILD.md](SOURCE-BUILD.md#compact-runtimepy) |
| `profile-supervisor.mjs` | Runs Cindy for a profile and publishes runtime evidence |
| `github-device-login.py`, `github-device-login-proof.py` | Host GitHub device-login helper shipped in the image, and its offline proof |
| [`runtime-activity/`](runtime-activity/README.md) | Overlay: live task activity that blocks restarts |
| [`runtime-maintenance/`](runtime-maintenance/README.md) | Overlay: maintenance gate and clean-shutdown evidence |
| [`runtime-guidance/`](runtime-guidance/README.md) | Overlay: cloud configuration guidance in agent prompts |
| [`runtime-updates/`](runtime-updates/README.md) | Overlay: disable the desktop updater; CIS owns upgrades |
| [`runtime-window-controls/`](runtime-window-controls/README.md) | Overlay: keep the main window open |
| [`runtime-identity/`](runtime-identity/README.md) | Overlay: hide sign-out and account switching |
| [`runtime-support/`](runtime-support/README.md) | Seccomp launcher, health check, keyring and profile maintenance/preflight programs |
| [`runtime-desktop-xfce/`](runtime-desktop-xfce/README.md) | PID 1 wrapper, Xfce/Plank desktop, Dock launchers, seccomp profile, liveness check |
| [`runtime-entrypoint/`](runtime-entrypoint/README.md) | Openbox PID 1 wrapper and shutdown-order test; not installed in the Xfce image |
| [`runtime-fonts/`](runtime-fonts/README.md) | Emoji font staging |
| `delivery/` | Pipeline scripts; see [delivery/README.md](delivery/README.md) |

## Local checks

These are the `verify` job's checks. Run them from the repository root with root
dependencies installed. They do not build or publish an image.

```sh
CINDY_TEST_CLIENT_SOURCE="$PWD" CINDY_ACTIVITY_TEST_SOURCE="$PWD" \
  CLOUD_UPDATE_TEST_SOURCE="$PWD" CLOUD_WINDOW_TEST_SOURCE="$PWD" \
  node --test deploy/linux-desktop/build-version.test.mjs \
    deploy/linux-desktop/prime-native-cache.test.mjs deploy/linux-desktop/runtime-*/*.test.mjs \
    deploy/linux-desktop/download-build-assets.test.mjs deploy/linux-desktop/delivery/*.test.mjs
export PYTHONDONTWRITEBYTECODE=1
python3 -m unittest discover -s deploy/linux-desktop -p 'test_*.py' -v
python3 -m unittest discover -s deploy/linux-desktop/runtime-base -p 'test_*.py' -v
python3 -m unittest discover -s deploy/linux-desktop/delivery -p 'test_*.py' -v
python3 deploy/linux-desktop/runtime-fonts/test_stage_emoji_font.py
# Version and upstream-tag check; needs the upstream tag locally or --fetch-upstream.
python3 deploy/linux-desktop/delivery/plan.py --output /tmp/cindy-delivery-plan.json
actionlint -config-file deploy/linux-desktop/delivery/actionlint.yaml \
  .github/workflows/cloud-image-delivery.yml
```

The entrypoint shutdown-order test needs Bash >= 5.1 and Python 3 and is skipped
otherwise. These checks use synthetic data; they do not replace
[runtime acceptance](SOURCE-BUILD.md#runtime-acceptance).
