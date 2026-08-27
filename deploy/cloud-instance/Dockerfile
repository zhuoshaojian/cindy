# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=10.33.2

FROM ${NODE_IMAGE} AS base

# Production runtime inherits both settings from base. Chromium's SUID sandbox
# cannot be configured for the unprivileged non-root user, so the Pod/container
# boundary is the isolation layer; the container also has no Secret Service or
# keyring for Electron safeStorage. Both are production runtime requirements.
ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    DISPLAY=:99 \
    ELECTRON_DISABLE_SANDBOX=1 \
    XDT_DEV_SAFE_STORAGE_BASIC=1

# Optional Debian package mirror, same shape as XDT_AGENT_BINARY_MIRROR_BASE_URL:
# empty keeps the upstream default (deb.debian.org) so CI behaviour is unchanged.
# Builders inside a region where the default mirror is throttled can point this at
# a local mirror — fetching the package index alone took ~17 minutes from the
# cn-shanghai build node, which makes the whole image build impractical.
ARG DEBIAN_MIRROR_BASE_URL=""
RUN if [ -n "${DEBIAN_MIRROR_BASE_URL}" ]; then \
      case "${DEBIAN_MIRROR_BASE_URL}" in \
        https://*|http://*) ;; \
        *) echo "DEBIAN_MIRROR_BASE_URL must be an absolute http(s) URL" >&2; exit 1 ;; \
      esac; \
      sed -i "s|https\?://deb.debian.org|${DEBIAN_MIRROR_BASE_URL}|g" \
        /etc/apt/sources.list.d/debian.sources; \
    fi

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    python3 \
    xvfb \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libsecret-1-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
  && install -d -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin cindy \
  && mkdir -p /opt/cindy /var/lib/cindy/user-data /var/lib/cindy/status /var/lib/cindy/workspaces \
  && chown -R cindy:cindy /opt/cindy /var/lib/cindy
COPY --chmod=0755 deploy/cloud-instance/entrypoint.sh /usr/local/bin/cindy-cloud-entrypoint
COPY --chmod=0755 deploy/cloud-instance/healthcheck.mjs /usr/local/bin/cindy-cloud-healthcheck.mjs
COPY --chmod=0755 deploy/cloud-instance/check-capabilities.mjs /usr/local/bin/cindy-cloud-check-capabilities.mjs
ENTRYPOINT ["/usr/local/bin/cindy-cloud-entrypoint"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD ["node", "/usr/local/bin/cindy-cloud-healthcheck.mjs"]

FROM base AS source

ARG PNPM_VERSION
ARG TARGETOS
ARG TARGETARCH
RUN test "${TARGETOS}" = linux && test "${TARGETARCH}" = amd64

ENV NODE_ENV=development \
    PATH=/workspace/apps/claude-code-bin/linux-x64:/workspace/apps/codex-bin/linux-x64:/workspace/apps/ripgrep-bin/linux-x64:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
  && test "$(pnpm --version)" = "${PNPM_VERSION}"
WORKDIR /workspace

# The workflow supplies a generated, tracked-only build context. Keep this COPY
# list explicit as a second boundary: BuildKit never needs mobile, repository
# metadata, developer config, or arbitrary top-level files to package Desktop.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY dependency-patches/ ./dependency-patches/
COPY apps/desktop/ ./apps/desktop/
# The shared lockfile contains five Mobile file: snapshots. pnpm validates
# their package manifests even for a Desktop-filtered install; source is not
# included in the generated build context.
COPY apps/mobile/modules/xdt-ios-app-distribution/package.json ./apps/mobile/modules/xdt-ios-app-distribution/package.json
COPY apps/mobile/modules/xdt-mobile-realtime-audio/package.json ./apps/mobile/modules/xdt-mobile-realtime-audio/package.json
COPY apps/mobile/modules/xdt-screenshot-monitor/package.json ./apps/mobile/modules/xdt-screenshot-monitor/package.json
COPY apps/mobile/modules/xdt-tapdb/package.json ./apps/mobile/modules/xdt-tapdb/package.json
COPY apps/mobile/modules/xdt-wechat-login/package.json ./apps/mobile/modules/xdt-wechat-login/package.json
COPY appicon/ ./appicon/
# 协议包已内联进本仓 `packages/`(上游 2026-08 去掉了 cindy-protocol submodule),
# 上面这行 COPY 已经把它们带进来了,不再单独拷 submodule 路径。
COPY packages/ ./packages/
COPY scripts/ ./scripts/
COPY tools/ ./tools/
COPY docs/legal/notices/ ./docs/legal/notices/
COPY config/endpoint.json config/endpoint.global.json ./config/
# Optional deterministic source for repository-pinned agent runtime assets.
# Empty preserves the existing upstream/CDN behavior; configured mode is fail-closed.
ARG XDT_AGENT_BINARY_MIRROR_BASE_URL=""
# Optional Electron release mirror, same shape as DEBIAN_MIRROR_BASE_URL: empty
# keeps @electron/get on its GitHub default. The archive is normally fetched once
# into the shared cache mount below, so this only matters when that cache is cold
# — but then the GitHub fetch decides whether the build finishes at all. Measured
# from the cn-shanghai build node with a cold cache: packaging sat on an open
# connection to GitHub's CDN with zero log output and zero CPU. Exported per RUN
# rather than as a stage ENV so an unset value stays unset, and because the
# runtime stage starts from `base` no mirror URL can reach the shipped image.
ARG ELECTRON_MIRROR_BASE_URL=""
RUN if [ -n "${ELECTRON_MIRROR_BASE_URL}" ]; then \
      case "${ELECTRON_MIRROR_BASE_URL}" in \
        https://*|http://*) ;; \
        *) echo "ELECTRON_MIRROR_BASE_URL must be an absolute http(s) URL" >&2; exit 1 ;; \
      esac; \
    fi
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,id=cindy-cloud-pnpm-store \
    --mount=type=cache,target=/root/.cache/electron,id=cindy-cloud-electron \
    if [ -n "${ELECTRON_MIRROR_BASE_URL}" ]; then export ELECTRON_MIRROR="${ELECTRON_MIRROR_BASE_URL}"; fi; \
    pnpm config set node-linker hoisted \
  && pnpm config set store-dir /root/.local/share/pnpm/store \
  && pnpm install --filter desktop... --prod=false --frozen-lockfile
RUN node scripts/ensure-agent-binaries-direct.mjs --platform=linux-x64
RUN node scripts/ensure-agent-binaries.mjs --platform=linux-x64
RUN node scripts/ensure-deps.mjs
RUN node scripts/ensure-dev-runtime-assets.mjs

# Local compose selects this stage explicitly. The final runtime stage below is
# still the sole packaged image definition; local development does not maintain
# a second Dockerfile or runtime stage.
FROM source AS development
ENV NODE_ENV=development \
    HOME=/home/cindy
RUN mkdir -p /var/lib/cindy/user-data /var/lib/cindy/status /var/lib/cindy/workspaces \
  && chown -R cindy:cindy /workspace /var/lib/cindy
USER cindy
CMD ["pnpm", "dev:desktop:headless:local"]

# Forge owns the production Vite graph, resources, fuses, sqlite-vec staging and
# Electron-ABI native rebuild. Do not introduce a parallel headless build graph.
FROM source AS packager
ARG CINDY_BUILD_REGION=global
ARG ELECTRON_MIRROR_BASE_URL=""
# Region variants always rerun packaging; mount the shared Electron cache here
# as well so Forge reuses the archive populated during dependency install. The
# mirror is re-exported because Forge fetches on its own when that cache is cold.
RUN --mount=type=cache,target=/root/.cache/electron,id=cindy-cloud-electron \
  if [ -n "${ELECTRON_MIRROR_BASE_URL}" ]; then export ELECTRON_MIRROR="${ELECTRON_MIRROR_BASE_URL}"; fi; \
  NODE_OPTIONS=--max-old-space-size=8192 \
  CINDY_AUTH_REGION="${CINDY_BUILD_REGION}" \
  pnpm --filter desktop package --platform=linux --arch=x64
RUN node scripts/cloud-runtime-packaged-content-manifest.mjs \
  --asar=/workspace/apps/desktop/out/Cindy-linux-x64/resources/app.asar \
  --output=/workspace/cloud-runtime-packaged-content-manifest.json

FROM base AS runtime

ARG TARGETOS
ARG TARGETARCH
RUN test "${TARGETOS}" = linux && test "${TARGETARCH}" = amd64

ARG BUILD_DATE=unknown
ARG VCS_REF=unknown
ARG VERSION=dev
LABEL org.opencontainers.image.title="Cindy cloud runtime" \
      org.opencontainers.image.description="Packaged Cindy headless runtime for cloud instances" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/makecindy/cindy"

ENV CI=1 \
    NODE_ENV=production \
    HOME=/home/cindy \
    CINDY_CLOUD_PACKAGED_EXECUTABLE=/opt/cindy/Cindy \
    PATH=/workspace/apps/claude-code-bin/linux-x64:/workspace/apps/codex-bin/linux-x64:$PATH
WORKDIR /workspace

COPY --from=packager --chown=cindy:cindy /workspace/apps/desktop/out/Cindy-linux-x64/ /opt/cindy/
COPY --from=packager --chown=cindy:cindy /workspace/apps/claude-code-bin/linux-x64/ /workspace/apps/claude-code-bin/linux-x64/
COPY --from=packager --chown=cindy:cindy /workspace/apps/codex-bin/linux-x64/ /workspace/apps/codex-bin/linux-x64/
COPY --from=packager --chown=cindy:cindy /workspace/cloud-runtime-packaged-content-manifest.json /opt/cindy/resources/cloud-runtime-packaged-content-manifest.json

USER cindy
# Clear node:22's inherited ["node"] command so a normal container start gives
# the entrypoint zero arguments and selects /opt/cindy/Cindy --headless.
CMD []
