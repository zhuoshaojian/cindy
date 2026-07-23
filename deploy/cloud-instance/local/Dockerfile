FROM node:22-bookworm-slim

# ELECTRON_DISABLE_SANDBOX: Chromium's SUID sandbox cannot be configured for
# the unprivileged non-root user; the container boundary is the isolation
# layer for this local dev image. XDT_DEV_SAFE_STORAGE_BASIC: no Secret
# Service/keyring exists in the container; production providers must inject a
# real secret-store strategy. Both are image runtime requirements, not
# compose-specific choices — any launcher (compose or LocalDockerProvider)
# needs them.
ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    DISPLAY=:99 \
    NODE_ENV=development \
    ELECTRON_DISABLE_SANDBOX=1 \
    XDT_DEV_SAFE_STORAGE_BASIC=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    g++ \
    make \
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
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin cindy
WORKDIR /workspace

# The repository .dockerignore excludes env files, logs, credentials, and host
# user data. Agent assets are installed from their checked-in version pins.
COPY . .
RUN pnpm install --frozen-lockfile \
  && node scripts/ensure-agent-binaries.mjs --platform=linux-x64 \
  && mkdir -p /var/lib/cindy/user-data /var/lib/cindy/status /var/lib/cindy/workspaces \
  && chown -R cindy:cindy /workspace /var/lib/cindy

COPY deploy/cloud-instance/local/entrypoint.sh /usr/local/bin/cindy-cloud-entrypoint
COPY deploy/cloud-instance/local/healthcheck.mjs /usr/local/bin/cindy-cloud-healthcheck.mjs
COPY deploy/cloud-instance/local/check-capabilities.mjs /usr/local/bin/cindy-cloud-check-capabilities.mjs
RUN chmod 0755 /usr/local/bin/cindy-cloud-entrypoint \
  /usr/local/bin/cindy-cloud-healthcheck.mjs \
  /usr/local/bin/cindy-cloud-check-capabilities.mjs

USER cindy
ENTRYPOINT ["/usr/local/bin/cindy-cloud-entrypoint"]
