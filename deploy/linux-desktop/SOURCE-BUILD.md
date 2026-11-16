# Building the cloud runtime image

`build-image.py` builds the CN `linux/amd64` runtime image from Git. It does not
publish images, create ACS caches or touch instances; the
[delivery pipeline](delivery/README.md) runs it and then smoke-tests and publishes.

## Inputs

- `delivery/version.json`: upstream version, upstream commit and cloud revision. They
  set the application version, image labels and build records; see
  [DUAL-VERSION-UPDATES.md](DUAL-VERSION-UPDATES.md).
- `source-freeze.json`:
  - `commit`: the application source commit. The builder checks that the `upstream`
    tag resolves to `upstreamCommit` and that this commit contains it.
  - `upstream`: `v<upstreamVersion>`. `packagingAllowed` must be `true`.
  - `baseRecipeCommit` (optional): build and cache the dependency base under this
    commit. It is accepted only if every base input is byte-identical there and at
    HEAD, so a rebase does not rebuild an unchanged base. Without it, the last commit
    that changed a base input is used. The commit must be present in the clone.
  - `includedPatch` is `{}`: all application source comes from `commit`.
  - `cloudParent`, `scope` and `formalPromotionAllowed` are records; the build does not read them.
- The recipe is `deploy/linux-desktop/` at HEAD. Commit it first: tracked or untracked
  changes there are rejected.

## Build

Host tools: Git with Git LFS and full history (`blob:none` partial clones work),
Python >= 3.12 and Docker Buildx. The upstream tag must exist locally
(`delivery/plan.py --fetch-upstream` fetches it). Release images are built on native
amd64. An Apple Silicon build runs under emulation and only checks the recipe.

```sh
python3 deploy/linux-desktop/build-image.py \
  --tag cindy-runtime-cn:<unique-tag> \
  --output /absolute/private/dir/<new-dir>
```

The tag must not exist locally and must not be a bare `X.Y.Z`. The output directory
must not exist.

- `--prepare-only`: export the build context and `build-inputs.json`; do not start Docker.
- `--builder NAME`: use an existing native amd64 Buildx builder. Both Dockerfiles are
  joined into one Bake graph (`Dockerfile.combined`).
- `--cache-repository REGISTRY/REPO`: import and export BuildKit cache; requires
  `--builder`. Use a private repository with mutable tags, never the runtime release
  repository. See [build cache](delivery/README.md#构建缓存).
- `--no-cache`: do not use cached steps or import cache; with `--cache-repository`
  the new cache is still exported.

## What the build does

1. `git archive` exports the recipe (HEAD) and the application source (`commit`). Each
   Git LFS pointer is resolved through Git LFS and checked against its SHA-256 and
   size; a missing or corrupt object stops the build. Worktree files are never used.
2. `runtime-base-slim` builds the [dependency base](runtime-base/README.md) as one layer.
3. `prepared` installs pnpm dependencies, Electron, agent assets and Linux build
   headers. Build-only Debian packages come from a public mirror of the signed Debian
   archive; apt verifies them with the Debian keyring and versions are pinned.
4. `dock-build` rebuilds `libplank` from checksum-pinned sources to hide Dock
   Preferences ([details](runtime-desktop-xfce/plank/README.md)). Build tools stay in
   this stage.
5. `prepared-native` prebuilds `better-sqlite3` and `node-pty` for the pinned Electron.
6. `build` applies the cloud overlays and cloud version, packages with Forge, bundles
   the maintenance context and runtime wire, and bundles the Claude and Codex CLIs.
   With networking off it runs the packaged SQLite, sqlite-vec and PTY modules under
   the pinned Electron, then assembles `/layer`, clamps its timestamps to
   `SOURCE_DATE_EPOCH` and audits permissions and links.
7. `runtime` is the base plus one `COPY` of `/layer`, user `cindy`, the seccomp
   entrypoint and the version labels. `build-records` collects the audit and input records.
8. `release_guard.py` checks the image. `result.json` records the local image ID with
   `runtimeAcceptance: pending`.

The output directory holds `build-inputs.json`, Docker commands and logs, base and
runtime image configs, `records/` and `result.json`. A local image ID is not a
registry manifest digest. No user HOME, credentials, business data or Docker socket
is mounted into build stages.

## Image layout

The image has exactly two layers: the single-layer dependency base and one
application layer. `release_guard.py` and `publish.py` reject any other layout. Do not
build on top of an earlier application image: files overwritten or deleted in a new
layer still occupy the lower layers.

### compact-runtime.py

Optional tool; the pipeline does not use it. It repackages a validated local image
(immutable digest or image ID; mutable tags are rejected) into a `FROM scratch`
dependency layer without `/opt/cindy`, plus one `/opt/cindy` layer. It uses no `RUN`
steps and needs BuildKit frontend >= 1.19 for `COPY --exclude`. It then compares
every file (bytes, type, owner, mode, link target, hardlinks, xattrs), the runtime
config and the layer count. It copies built files and does not build from source,
so it cannot qualify a release. It pushes nothing, and the output directory must not exist.

```sh
python3 deploy/linux-desktop/compact-runtime.py \
  --source 'registry.example.invalid/cindy/runtime@sha256:<digest>' \
  --base-tag cindy-runtime-base:<id> --tag cindy-runtime:<id> \
  --output /private/cache/cindy-image-<id>
```

## Runtime acceptance

A successful build is not runtime acceptance. The pipeline's
[isolated smoke](delivery/README.md#隔离-smoke) covers startup, sandboxing, legacy HOME
ownership and shutdown only. Before an image is approved for instances, test that
exact image on native Linux amd64 with disposable data and synthetic credentials:

- managed identity readiness and keyring;
- sandboxed renderers and Chrome authorization tab cleanup;
- Terminal and Chrome launch from the Dock, minimize/restore, fullscreen;
- native mouse and keyboard, Unicode text in the Chrome address bar, pages and
  terminal, focus and cancellation, emoji;
- [existing user launchers](runtime-desktop-xfce/README.md#existing-user-launchers)
  in an existing HOME, with launched windows merged into their pinned Dock icons;
- the [runtime observation](PROFILE-OBSERVATION.md) checks;
- orderly maintenance shutdown.

Native X11 tests do not cover DeviceLink end to end, and OAuth and DeviceLink need
their own tests. Prepare ACS caches for the main image and every actual
initContainer image before an instance is upgraded. CIS owns task protection,
backup, upgrade and recovery.
