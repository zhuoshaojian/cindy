# syntax=docker/dockerfile:1.10@sha256:865e5dd094beca432e8c0a1d5e1c465db5f998dca4e439981029b3b81fb39ed5

# Cindy cloud runtime dependency base: CN, linux/amd64, one layer, no /opt/cindy.
# Third-party files from pinned inputs only. Build context: deploy/linux-desktop.
# See README.md.

# amd64 manifest sha256:107ceb6ad85808049dccef12414bf17b08eceb299eaf755c0339dc5fc8958d6b.
ARG NODE_IMAGE=node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b

FROM ${NODE_IMAGE} AS snapshot
SHELL ["/bin/bash", "-o", "errexit", "-o", "nounset", "-o", "pipefail", "-c"]
# A mirror must serve snapshot.debian.org's signed archive unchanged; the base
# image's Debian archive keyring still verifies every index it returns.
ARG DEBIAN_SNAPSHOT_URL=https://snapshot.debian.org
RUN --mount=type=bind,source=runtime-base,target=/recipe <<'EOF'
case "$DEBIAN_SNAPSHOT_URL" in
  https://*) ;;
  *) echo 'DEBIAN_SNAPSHOT_URL must be an https URL' >&2; exit 1 ;;
esac
test "$(dpkg --print-architecture)" = amd64
snapshot="${DEBIAN_SNAPSHOT_URL%/}/archive"
# Both snapshot runs list every locked version as the current one.
cat > /etc/apt/sources.list.d/debian.sources <<SOURCES
Types: deb
URIs: ${snapshot}/debian/20260905T205002Z
Suites: bookworm bookworm-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
Check-Valid-Until: no

Types: deb
URIs: ${snapshot}/debian-security/20260905T234553Z
Suites: bookworm-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
Check-Valid-Until: no
SOURCES
python3 -I /recipe/base_lock.py preferences /recipe/packages.lock > /etc/apt/preferences.d/cindy-base-lock.pref
apt-get -o Acquire::Retries=5 update
EOF

FROM snapshot AS fetch
# Artifacts outside the Debian archive. Mirror them into a controlled store and
# override the URL when upstream stops serving it; the checksum stays pinned.
ARG CHROME_DEB_URL=https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_155.0.8059.84-1_amd64.deb
ARG GH_TARBALL_URL=https://github.com/cli/cli/releases/download/v2.100.0/gh_2.100.0_linux_amd64.tar.gz
# Developer tools for a home without root: static release binaries only.
ARG DOCKER_TARBALL_URL=https://download.docker.com/linux/static/stable/x86_64/docker-29.7.2.tgz
ARG COMPOSE_BINARY_URL=https://github.com/docker/compose/releases/download/v5.8.0/docker-compose-linux-x86_64
ARG BUILDX_BINARY_URL=https://github.com/docker/buildx/releases/download/v0.39.1/buildx-v0.39.1.linux-amd64
ARG UV_TARBALL_URL=https://github.com/astral-sh/uv/releases/download/0.13.10/uv-x86_64-unknown-linux-musl.tar.gz
ARG JQ_BINARY_URL=https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-linux-amd64
ARG RIPGREP_TARBALL_URL=https://github.com/BurntSushi/ripgrep/releases/download/16.0.0/ripgrep-16.0.0-x86_64-unknown-linux-musl.tar.gz
ARG MISE_BINARY_URL=https://github.com/jdx/mise/releases/download/v2026.11.14/mise-v2026.11.14-linux-x64-musl
ADD --checksum=sha256:8fbd2ae69cdf7ee98b7513c3396a7b5e06f974f8625fdd590df3091dd0c3e9de \
    ${CHROME_DEB_URL} /downloads/google-chrome-stable_155.0.8059.84-1_amd64.deb
ADD --checksum=sha256:e4d4bb4498e8d007abe545b6568926793ace1b6447da598294a610018cb164be \
    ${GH_TARBALL_URL} /downloads/gh_2.100.0_linux_amd64.tar.gz
ADD --checksum=sha256:803d433f226db4776e1768fd319fc6c6e4935a456acf84fcc0080818b854bc8f \
    ${DOCKER_TARBALL_URL} /downloads/docker-29.7.2.tgz
ADD --checksum=sha256:b8840f5008c447f41fce0a57ae3adeab42c89b1eb6e6012524bcabbfb4ffbaf6 \
    ${COMPOSE_BINARY_URL} /downloads/docker-compose-v5.8.0-linux-x86_64
ADD --checksum=sha256:903090816da68f8bc1a2ff5346dd163a5adacfce4548d003c75df42cd47a9bf4 \
    ${BUILDX_BINARY_URL} /downloads/buildx-v0.39.1.linux-amd64
ADD --checksum=sha256:5597970380083a340b7983af05a84824b4db1c62b7059c796935b7fd6dc95fd2 \
    ${UV_TARBALL_URL} /downloads/uv-0.13.10-x86_64-unknown-linux-musl.tar.gz
ADD --checksum=sha256:b1c22172dd303f3be49e935aa56aa48a8b7a46e0bc838b4997d3bb451495870f \
    ${JQ_BINARY_URL} /downloads/jq-1.8.2-linux-amd64
ADD --checksum=sha256:54268ab4643c00a290a29b0086066d64b3f56236dd805ec64629a86f9bd29fd0 \
    ${RIPGREP_TARBALL_URL} /downloads/ripgrep-16.0.0-x86_64-unknown-linux-musl.tar.gz
ADD --checksum=sha256:3b2dbc7011bfd96c4b1160db2bca9f0937f226cc61ae5beddfd1fec536e81b2a \
    ${MISE_BINARY_URL} /downloads/mise-v2026.11.14-linux-x64-musl
RUN --mount=type=bind,source=.,target=/recipe <<'EOF'
umask 022
install -d -o _apt /debs
install -d /x /out
cd /debs
# Files from packages that are not installed themselves.
# apt verifies the signed index; this list is the independent pin.
apt-get -o Acquire::Retries=5 download arc-theme=20221218-1 papirus-icon-theme=20230104-2 \
  fonts-noto-color-emoji=2.042-0+deb12u1 libturbojpeg0=1:2.1.5-2 libjson-c5=0.16-2 \
  locales=2.36-9+deb12u14
sha256sum --check --strict <<'SUMS'
75f14c832bd7c6e3b0c210db1e84d278ba75ac359a423488f61df9877ac4903e  arc-theme_20221218-1_all.deb
3d00a7f3ed7bb2c74ed0dc4853ce7cf21b43f7b7bb0a033df7443c271077bace  papirus-icon-theme_20230104-2_all.deb
a5ab0f69c7938423862320d9aca5dd187b3fd879d6a9a57dd52e17c3fa8d2751  fonts-noto-color-emoji_2.042-0+deb12u1_all.deb
466d8e2a6b501c43d9064e19972465e7703611a9c344f0244cb3bedbc2a328bc  libturbojpeg0_1%3a2.1.5-2_amd64.deb
d0e1ed8637d1c26b9720f6057d6355f18378bba5cc2553e459d1632783c00d70  libjson-c5_0.16-2_amd64.deb
00c6e3d9456411ac78b199b577f25231be80186796ebdff65089240154ebbcb0  locales_2.36-9+deb12u14_all.deb
SUMS
test "$(find /debs -mindepth 1 | wc -l)" -eq 6
for deb in /debs/*.deb; do
  name="$(basename "$deb")"
  dpkg-deb --extract "$deb" "/x/${name%%_*}"
done

# Arc and Papirus: only the variants the desktop uses, with package metadata.
install -d /out/usr/share/themes /out/usr/share/icons
cp -a /x/arc-theme/usr/share/themes/{Arc,Arc-Dark,Arc-Darker} /out/usr/share/themes/
cp -a /x/papirus-icon-theme/usr/share/icons/{Papirus,Papirus-Dark,Papirus-Light} /out/usr/share/icons/
# Noto Color Emoji, checked and staged by the font helper.
python3 -I /recipe/runtime-fonts/stage-emoji-font.py /x/fonts-noto-color-emoji /out > /dev/null
# The remote-desktop native module loads these two sonames directly.
install -D -m 0644 /x/libturbojpeg0/usr/lib/x86_64-linux-gnu/libturbojpeg.so.0.2.0 \
  /out/usr/lib/x86_64-linux-gnu/libturbojpeg.so.0
install -D -m 0644 /x/libjson-c5/usr/lib/x86_64-linux-gnu/libjson-c.so.5.2.0 \
  /out/usr/lib/x86_64-linux-gnu/libjson-c.so.5
# zh_CN.UTF-8 compiled by this image's own localedef from the matching glibc sources.
gzip --decompress --stdout /x/locales/usr/share/i18n/charmaps/UTF-8.gz > /x/UTF-8
install -d /out/usr/lib/locale
I18NPATH=/x/locales/usr/share/i18n localedef --no-archive -i zh_CN -f /x/UTF-8 \
  /out/usr/lib/locale/zh_CN.utf8
install -D -m 0644 /x/locales/usr/share/doc/locales/copyright /out/usr/share/doc/locales/copyright
printf 'LANG=zh_CN.UTF-8\nLANGUAGE=zh_CN:zh\n' > /x/locale
install -D -m 0644 /x/locale /out/etc/default/locale
# GitHub CLI: the release binary only.
tar --extract --gzip --file /downloads/gh_2.100.0_linux_amd64.tar.gz --directory /x \
  gh_2.100.0_linux_amd64/bin/gh
install -D -m 0755 /x/gh_2.100.0_linux_amd64/bin/gh /out/usr/local/bin/gh
# Developer tools: the Docker CLI with its Compose and Buildx plugins (no
# daemon), uv and uvx, jq, ripgrep and mise. Their data lives under HOME.
tar --extract --gzip --file /downloads/docker-29.7.2.tgz --directory /x docker/docker
install -D -m 0755 /x/docker/docker /out/usr/local/bin/docker
install -D -m 0755 /downloads/docker-compose-v5.8.0-linux-x86_64 \
  /out/usr/local/lib/docker/cli-plugins/docker-compose
install -D -m 0755 /downloads/buildx-v0.39.1.linux-amd64 \
  /out/usr/local/lib/docker/cli-plugins/docker-buildx
tar --extract --gzip --file /downloads/uv-0.13.10-x86_64-unknown-linux-musl.tar.gz --directory /x \
  uv-x86_64-unknown-linux-musl/uv uv-x86_64-unknown-linux-musl/uvx
install -m 0755 /x/uv-x86_64-unknown-linux-musl/uv /x/uv-x86_64-unknown-linux-musl/uvx \
  /out/usr/local/bin/
install -m 0755 /downloads/jq-1.8.2-linux-amd64 /out/usr/local/bin/jq
tar --extract --gzip --file /downloads/ripgrep-16.0.0-x86_64-unknown-linux-musl.tar.gz --directory /x \
  ripgrep-16.0.0-x86_64-unknown-linux-musl/rg
install -m 0755 /x/ripgrep-16.0.0-x86_64-unknown-linux-musl/rg /out/usr/local/bin/rg
install -m 0755 /downloads/mise-v2026.11.14-linux-x64-musl /out/usr/local/bin/mise
EOF

FROM snapshot AS assembled
ARG CINDY_SOURCE_COMMIT
RUN --mount=type=bind,source=runtime-base,target=/recipe \
    --mount=type=bind,from=fetch,source=/downloads,target=/downloads <<'EOF'
[[ "$CINDY_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'CINDY_SOURCE_COMMIT must be the full commit of this recipe' >&2
  exit 1
}
# Logs only record this build; keep the base image's originals instead.
cp -a /var/log /tmp/base-log
mapfile -t manual < <(python3 -I /recipe/base_lock.py manual /recipe/packages.lock \
  --exclude google-chrome-stable)
apt-get -o Acquire::Retries=5 install --yes --no-install-recommends "${manual[@]}" \
  /downloads/google-chrome-stable_155.0.8059.84-1_amd64.deb
EOF
COPY --from=fetch /out/ /
RUN --mount=type=bind,source=runtime-base,target=/recipe <<'EOF'
# Index the two copied sonames.
ldconfig
# A fixed epoch keeps the password-age record in /etc/shadow reproducible.
SOURCE_DATE_EPOCH=1789344000 useradd --create-home --uid 10001 --shell /usr/sbin/nologin cindy
corepack enable
# dbus generates a random ID on install; a fixed one keeps the layer reproducible
# and the machine ID of a home directory stable across image upgrades.
printf '36c1a9d00cf02ee536892c246aa7ccfa\n' > /var/lib/dbus/machine-id
python3 -I /recipe/base_lock.py verify /recipe/packages.lock
rm /etc/apt/preferences.d/cindy-base-lock.pref
# Record the canonical snapshot even when a mirror served the build.
sed --in-place --regexp-extended \
  's#^URIs: .*/archive/(debian(-security)?/[0-9]{8}T[0-9]{6}Z)$#URIs: https://snapshot.debian.org/archive/\1#' \
  /etc/apt/sources.list.d/debian.sources
grep --count '^URIs: https://snapshot.debian.org/archive/' /etc/apt/sources.list.d/debian.sources \
  | grep --line-regexp --quiet 2
rm -rf /var/log && mv /tmp/base-log /var/log
# Font caches record each scanned directory's mtime, including symlinked ones
# (poppler cMaps). Fix those mtimes, then rebuild the caches, so they stay valid
# in the image and rebuilds yield identical bytes.
# ldconfig's aux-cache only speeds up ldconfig itself and records inodes.
find -L /usr/share/fonts /usr/local/share/fonts -type d -exec touch --date=@1789344000 {} +
fc-cache --force --system-only
rm /var/cache/ldconfig/aux-cache
# Last: an emulated build's translator can add a cache under HOME for every
# new process. Only shell builtins follow this cleanup.
rm -rf /var/lib/apt/lists/* /var/cache/apt/*.bin /tmp/* /root/.cache
[[ ! -e /root/.cache ]]
EOF

FROM scratch AS runtime-base
ARG CINDY_SOURCE_COMMIT
COPY --from=assembled / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_VERSION=24.19.0 \
    YARN_VERSION=1.22.22 \
    LANG=zh_CN.UTF-8 \
    LANGUAGE=zh_CN:zh
LABEL io.cindy.base-recipe-commit=${CINDY_SOURCE_COMMIT} \
      io.cindy.region=cn \
      io.cindy.target-architecture=amd64

# The application is built on this variant: the full target above without the
# duplicate browser. Development and agent tools stay available.
FROM assembled AS trimmed
RUN --mount=type=bind,source=runtime-base,target=/recipe <<'EOF'
apt-get --yes purge chromium chromium-common chromium-sandbox
python3 -I - <<'PY'
import sys
sys.path.insert(0, '/recipe')
import base_lock
expected = base_lock.read_lock(open('/recipe/packages.lock').read())
for package in ('chromium', 'chromium-common', 'chromium-sandbox'):
    del expected[(package, 'amd64')]
actual = base_lock.parse_installed(base_lock.run('dpkg-query', '-W', '-f=' + base_lock.DPKG_FORMAT),
                                   base_lock.run('apt-mark', 'showmanual'))
problems = base_lock.differences(expected, actual)
if problems: raise SystemExit('\n'.join(problems))
print('SLIM_PACKAGE_LOCK_VERIFIED', len(actual))
PY
rm -rf /var/lib/apt/lists/* /var/cache/apt/*.bin /tmp/* /root/.cache
EOF

# Cache timestamp canonicalization before flattening. The private /rootfs tree
# avoids traversing build-time /proc, /sys, /dev or following absolute symlinks.
FROM snapshot AS normalized-slim
COPY --from=trimmed / /rootfs/
ARG SOURCE_DATE_EPOCH
RUN --mount=type=bind,source=normalize-timestamps.py,target=/normalize-timestamps.py \
    python3 -I /normalize-timestamps.py /rootfs

FROM scratch AS runtime-base-slim
ARG CINDY_SOURCE_COMMIT
COPY --from=normalized-slim /rootfs/ /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_VERSION=24.19.0 YARN_VERSION=1.22.22 LANG=zh_CN.UTF-8 LANGUAGE=zh_CN:zh
LABEL io.cindy.base-recipe-commit=${CINDY_SOURCE_COMMIT} \
      io.cindy.region=cn io.cindy.target-architecture=amd64 \
      io.cindy.base-variant=single-browser
