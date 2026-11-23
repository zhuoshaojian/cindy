# Cloud runtime dependency base

`Dockerfile` builds the **third-party** filesystem of the CN `linux/amd64` cloud
runtime from pinned inputs only. The output is a single layer without `/opt/cindy`
and without Cindy-owned programs; the application layer (`../Dockerfile`,
`../assemble-runtime.py`) adds both.

Targets:

- `runtime-base`: the full reference base with all 606 locked packages.
- `runtime-base-slim`: the release base. It starts from the same inputs, purges
  exactly `chromium`, `chromium-common` and `chromium-sandbox`, verifies the
  remaining 603-package lock without autoremove or upgrades, normalizes timestamps
  and flattens to one layer. Chrome, development tools and all other libraries
  remain. `../build-image.py` always builds the application on this target.

## Pinned inputs

| Input | Pin |
| --- | --- |
| Dockerfile frontend | `docker/dockerfile:1.10@sha256:865e5dd0…` |
| Base image | `node:24.19.0-bookworm@sha256:4196d66a…` (amd64 `sha256:107ceb6a…`) |
| Debian archive | snapshot.debian.org `debian/20260905T205002Z` (bookworm, bookworm-updates) and `debian-security/20260905T234553Z`, verified with the image's Debian archive keyring |
| Debian packages | `packages.lock`: every installed package with version, architecture and manual/auto mark. Each entry is pinned at priority 1001 while installing |
| Files from Debian packages that are not installed | `arc-theme 20221218-1` (Arc, Arc-Dark, Arc-Darker), `papirus-icon-theme 20230104-2` (Papirus, -Dark, -Light), `fonts-noto-color-emoji 2.042-0+deb12u1` (staged by `../runtime-fonts/stage-emoji-font.py`), `libturbojpeg0 1:2.1.5-2` and `libjson-c5 0.16-2` (one soname each, loaded by the remote-desktop native module), `locales 2.36-9+deb12u14` (zh_CN.UTF-8 compiled by the image's `localedef`). Each `.deb` SHA-256 is listed in the Dockerfile |
| Google Chrome | `google-chrome-stable 155.0.8059.84-1`, `.deb` SHA-256 `8fbd2ae6…` |
| GitHub CLI | `gh 2.100.0` release tarball SHA-256 `e4d4bb44…`; only `bin/gh` is installed |

`base_lock.py verify` checks the installed set against `packages.lock` exactly: any
missing, extra or different package, version, architecture, install state or manual
mark fails the build. `base_lock.py capture <image-id> <output>` writes a lock from
an existing image. The recipe also creates the `cindy` account (UID/GID 10001,
`/usr/sbin/nologin`) with a fixed password-age date, runs `corepack enable`, writes
a fixed D-Bus machine ID and leaves the canonical snapshot URLs in the apt sources.

## Build

`build-image.py` builds `runtime-base-slim` as part of the full image. Its base
context holds only the five base inputs (`Dockerfile`, `packages.lock`,
`base_lock.py`, `../runtime-fonts/stage-emoji-font.py`, `../normalize-timestamps.py`).
The base is labelled with the last commit that changed them, or with the
`baseRecipeCommit` in `../source-freeze.json` when those inputs are byte-identical
there. Application and delivery changes therefore do not invalidate the base.

To build the reference target alone, use a native `linux/amd64` builder with
network access to the pinned sources. The context is `deploy/linux-desktop`;
`Dockerfile.dockerignore` limits it to the tracked inputs. `CINDY_SOURCE_COMMIT`
must be a full commit hash.

```sh
cd deploy/linux-desktop
docker buildx build --platform linux/amd64 -f runtime-base/Dockerfile \
  --build-arg CINDY_SOURCE_COMMIT="$(git rev-parse HEAD)" \
  --build-arg SOURCE_DATE_EPOCH=1789344000 --target runtime-base \
  --output type=docker,name=cindy-runtime-base-cn:<unused-local-tag>,rewrite-timestamp=true .
```

The fixed epoch and timestamp rewrite remove build time from the layer. The
recipe also pins the font-directory mtimes recorded by fontconfig, restores the
base image's logs and drops ldconfig's inode cache, so the payload depends only on
the pinned inputs.

`DEBIAN_SNAPSHOT_URL` (https only), `CHROME_DEB_URL` and `GH_TARBALL_URL` may point
at a controlled mirror of the same artifacts. Mirrors change transport only: the
Debian signatures, every SHA-256 and the lock still apply. Google keeps only recent
Chrome builds, so archive this `.deb`; mirror the base image by digest rather than
relying on Docker Hub retention.

A build under emulation (for example on Apple Silicon) only checks the recipe; it
is not a release artifact.

## Equivalence check

`compare-base.py` compares a rebuilt base with a reference runtime image, both by
immutable ID or digest. Containers are created but never started:

```sh
python3 runtime-base/compare-base.py --reference <reference-image-id> \
  --candidate <rebuilt-base-id> --output <new-output-dir>
```

Every path must match in type, bytes, mode, owner, link target, hardlink group and
xattrs, except these categories:

- `release-layer`: `/opt/cindy` and Cindy-owned files (`/usr/local/bin/cindy-*`,
  `claude`/`codex` links, `/usr/local/lib/cindy`, `/usr/local/share/cindy`,
  `com.cindy.*.desktop`, the `Cindy-Cloud` theme, `/run/cindy-profile-check`).
  They may only be absent from the base; the application layer ships them.
- `build-leftover`: `/root/.cache`, `/home/cindy/.cache`, `/home/cindy/.local` and
  `/tmp/*`. They may only be absent from the base.
- `changed-by-design`: `debian.sources` names the snapshot instead of a mirror.
- `order-insensitive`: apt's `extended_states`, dpkg's `triggers/File` and
  `bamf-2.index` are written in installation order. Their sorted records must be
  identical; dpkg's `status` database itself has no exemption.
- `transient`: `dpkg/status-old`, dpkg's backup from before its last transaction.
- `regenerated`: `/var/log` and `/var/cache`; type, owner and mode must match.

The candidate must also be a single-layer `linux/amd64` image without entrypoint,
command or user, with `LANG=zh_CN.UTF-8` and `NODE_VERSION=24.19.0`. A passing
comparison proves filesystem equivalence only; images built on the base still need
runtime acceptance.

`runtime-base-slim` differs from the full reference by design, so filesystem
equality alone cannot qualify it. The application layer keeps `/usr/bin/chromium`
as a wrapper to Google Chrome (`../runtime-support/chromium-compat`); private CDP
and sandbox behavior require authorization regression testing.

## Known properties

The full reference installs Chromium 152 next to Chrome 155; the two
remote-desktop libraries are copied sonames rather than installed packages; the
base keeps the full `buildpack-deps` toolchain. Cindy-owned files live in
`../runtime-support/` and the adjacent runtime directories. The complete assembly
and layer checks are in [SOURCE-BUILD.md](../SOURCE-BUILD.md).

To update a package, choose new snapshot runs, change the versions in the lock
deliberately, rebuild and compare against the previous base; review every changed
path before qualifying the new base.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/linux-desktop/runtime-base -p 'test_*.py' -v
```
