FROM node:22-bookworm-slim AS base

ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    DISPLAY=:99 \
    ELECTRON_DISABLE_SANDBOX=1 \
    XDT_DEV_SAFE_STORAGE_BASIC=1

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
COPY --chmod=0755 deploy/cloud-instance/local/entrypoint.sh /usr/local/bin/cindy-cloud-entrypoint
COPY --chmod=0755 deploy/cloud-instance/local/healthcheck.mjs /usr/local/bin/cindy-cloud-healthcheck.mjs
COPY --chmod=0755 deploy/cloud-instance/local/check-capabilities.mjs /usr/local/bin/cindy-cloud-check-capabilities.mjs
ENTRYPOINT ["/usr/local/bin/cindy-cloud-entrypoint"]

FROM base AS source

ENV NODE_ENV=production \
    PATH=/workspace/apps/claude-code-bin/linux-x64:/workspace/apps/codex-bin/linux-x64:/workspace/apps/ripgrep-bin/linux-x64:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.33.2 --activate
WORKDIR /workspace

# The repository .dockerignore excludes env files, logs, credentials, and host
# user data. Agent assets are installed from their checked-in version pins.
COPY . .
# Cache mounts persist across (failed) builds: pnpm's store and Electron's zip
# cache accumulate finished downloads, so a flaky network only re-fetches what
# never completed instead of restarting the whole multi-hundred-MB step.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,id=cindy-cloud-pnpm-store \
    --mount=type=cache,target=/root/.cache/electron,id=cindy-cloud-electron \
    pnpm config set store-dir /root/.local/share/pnpm/store \
  && pnpm install --frozen-lockfile
RUN node scripts/ensure-agent-binaries-direct.mjs --platform=linux-x64
RUN node scripts/ensure-agent-binaries.mjs --platform=linux-x64
RUN node scripts/ensure-deps.mjs
RUN node scripts/ensure-dev-runtime-assets.mjs

# Local compose targets this stage explicitly, retaining the existing
# source/Forge/Vite debugging flow without shipping it in the cloud image.
FROM source AS development
ENV NODE_ENV=development \
    HOME=/home/cindy
RUN mkdir -p /var/lib/cindy/user-data /var/lib/cindy/status /var/lib/cindy/workspaces \
  && chown -R cindy:cindy /workspace /var/lib/cindy
USER cindy
CMD ["pnpm", "dev:desktop:headless:local"]

# Forge package is the existing production build path: it owns every Vite
# entry, runtime resource, fuse, sqlite-vec copy, and Electron-ABI native
# rebuild. No parallel headless build graph is introduced.
FROM source AS packager
ARG CINDY_BUILD_REGION=global
RUN CINDY_AUTH_REGION="${CINDY_BUILD_REGION}" \
  pnpm --filter desktop package --platform=linux --arch=x64

FROM base AS runtime

# ELECTRON_DISABLE_SANDBOX: Chromium's SUID sandbox cannot be configured for
# the unprivileged non-root user; the Pod/container boundary is the isolation
# layer. XDT_DEV_SAFE_STORAGE_BASIC: no Secret Service/keyring exists in the
# container. Both are runtime requirements, independent of the launcher.
ENV CI=1 \
    NODE_ENV=production \
    HOME=/home/cindy \
    CINDY_CLOUD_PACKAGED_EXECUTABLE=/opt/cindy/Cindy \
    PATH=/workspace/apps/claude-code-bin/linux-x64:/workspace/apps/codex-bin/linux-x64:$PATH
WORKDIR /workspace

COPY --from=packager --chown=cindy:cindy /workspace/apps/desktop/out/Cindy-linux-x64/ /opt/cindy/
COPY --from=packager --chown=cindy:cindy /workspace/apps/claude-code-bin/linux-x64/ /workspace/apps/claude-code-bin/linux-x64/
COPY --from=packager --chown=cindy:cindy /workspace/apps/codex-bin/linux-x64/ /workspace/apps/codex-bin/linux-x64/

USER cindy
