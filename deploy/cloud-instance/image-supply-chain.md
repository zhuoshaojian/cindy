# Cloud runtime image supply chain

`deploy/cloud-instance/Dockerfile` is the sole packaged headless runtime image definition. Build-1
provides a native `linux/amd64` build-and-test pipeline; it does **not** publish, sign, promote or
deploy an image.

## Build/test artifact pipeline

`.github/workflows/build-cloud-runtime-image.yml` runs on relevant pull requests, relevant pushes to
`main`, and manual dispatches. Every trigger uses the same build/test-only job. The job:

1. uses a GitHub-hosted native Linux x64 runner and fails if the runner architecture or free disk
   prerequisite is not met;
2. validates the public `cindy-protocol` submodule source before fetching its pinned gitlink;
3. scans tracked and non-ignored untracked candidate inputs, then creates a temporary build context
   containing only the required tracked Desktop/package/protocol/build files; the Dockerfile applies
   a second explicit `COPY` whitelist before any cache export;
4. builds the `runtime` target as `linux/amd64`, loads it only into the job-local Docker daemon, and
   never logs in to a registry;
5. runs capability, health, non-root entrypoint, packaged Electron startup/SIGTERM and
   prohibited-content checks. The startup smoke proves that the packaged binary starts, its
   dynamic libraries and Xvfb initialize, app code is entered, and the entrypoint exits without a
   SIGKILL after `docker stop`; it does **not** prove full readiness, which requires Pod credentials
   and a real endpoint manifest. The packager scans `app.asar` with the already-installed asar
   library and emits a SHA-bound clean-scan manifest. Path rules inspect every archive entry, while
   content extraction and scanning cover only config files outside `node_modules`; third-party
   packages commonly contain localhost defaults, and extracting every config from a large asar is
   both noisy and expensive. The manifest separately records the total entry count, inspected
   non-`node_modules` config count, and skipped `node_modules` config count. The final image check
   recomputes the archive SHA before accepting that proof;
6. exports a short-lived gzip-compressed Docker image archive, archive SHA-256, tested local image
   config ID, a build/load digest with its exact source field, an SPDX image SBOM, and a Trivy
   Critical report;
7. fails on fixable Critical vulnerabilities.

## Known build/test coverage gaps

- CI currently builds and tests only `CINDY_BUILD_REGION=global`. A `cn` identity image is not built
  or tested by this workflow, and region identity is fixed at build time.
- The Trivy gate covers `CRITICAL` findings with `ignore-unfixed: true`; `HIGH` findings do not block
  this pipeline.
- The packaged startup smoke does not reproduce the production Pod security context, including its
  read-only root filesystem and dropped Linux capabilities.

The artifact tag is `sha-<40-character git revision>`. The archive SHA-256 binds the uploaded bytes,
and the loaded image config ID identifies the exact local image used by smoke checks and `docker
save`. The build/load digest comes from either the build action's direct digest output or its
`containerimage.config.digest` metadata field, and the metadata artifact records which source was
used. It is **not** a registry manifest digest and must never be used as a promotion handoff. A
future promotion pipeline must use the immutable digest returned by its registry push, then
scan/sign/verify that registry digest.

The uploaded artifact bundle and docker/build-push-action `.dockerbuild` record both expire after
seven days. These are CI test records, not released images and not evidence that ACS or ACR has been
deployed.

The container SPDX document describes the final image filesystem. It complements, but does not
replace, the repository distribution SBOMs generated under `docs/legal/notices/sbom/`.

## Secret boundary

The workflow has only `contents: read`. It does not request `packages: write` or `id-token: write`,
does not reference registry credentials, and does not use `pull_request_target`. Pull-request and
branch builds therefore cannot reach future promotion credentials.

The repository `.dockerignore`, pre-build context gate, generated tracked-only context, and explicit
Dockerfile `COPY` list jointly exclude `.env*`, local endpoint manifests, logs, user data,
safe-storage data, provider/registry/cluster configuration, private keys and
certificate/credential files. The final stage contains the packaged application and the pinned Linux
x64 Claude/Codex runtime assets, not the repository source tree, package manager store or build
toolchain.

The build currently uses only public package sources. If a future dependency needs authenticated
package access, credentials must enter the individual install instruction through a BuildKit secret
mount (`RUN --mount=type=secret`); they must never be added through `COPY`, build arguments, image
environment variables, or cacheable configuration files.

## Promotion and cosign prerequisites

Promotion stays a separate future pipeline. Before its closed gate may be replaced, all of the
following require an explicit operations/security decision:

- an ACR registry and immutable repository naming/tag policy;
- a protected GitHub Environment whose secrets are unavailable to pull requests and feature
  branches;
- a least-privilege federated/OIDC identity authorized only for the target repository;
- a registry-push step that returns the immutable promotion digest and a verified binding from the
  tested input/archive record to that push;
- a cosign mode (keyless is preferred if the environment policy permits it), expected certificate
  identity/issuer, Rekor/transparency policy, and verification command used by deployment;
- retention and provenance/attestation policy for the promoted digest.

Manual dispatch can exercise `check_promotion_readiness`; it deliberately exits with an error to
prove the gate is closed. Build-1 must not be interpreted as a successful signature or promotion.
