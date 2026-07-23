#!/bin/sh
set -eu

# This is an orchestration scaffold: it never prints secret contents.
node /usr/local/bin/cindy-cloud-check-capabilities.mjs

status_file="${CINDY_CLOUD_STATUS_FILE:-/var/lib/cindy/status/status.json}"
mkdir -p "$(dirname "$status_file")" "${XDT_USER_DATA_DIR:-/var/lib/cindy/user-data}"

xvfb_pid=''
child_pid=''
cleanup() {
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  if [ -n "$xvfb_pid" ] && kill -0 "$xvfb_pid" 2>/dev/null; then
    kill -TERM "$xvfb_pid" 2>/dev/null || true
  fi
}
trap cleanup TERM INT

Xvfb "${DISPLAY:-:99}" -screen 0 1280x800x24 -nolisten tcp >/tmp/cindy-xvfb.log 2>&1 &
xvfb_pid=$!

if [ "$#" -eq 0 ]; then
  set -- pnpm dev:desktop:headless:local
fi

"$@" &
child_pid=$!
set +e
wait "$child_pid"
exit_code=$?
set -e
cleanup
exit "$exit_code"
