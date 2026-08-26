#!/bin/sh
set -eu

: "${XDT_POD_WORKSPACES_DIR:=/var/lib/cindy/workspaces}"
export XDT_POD_WORKSPACES_DIR
case "$XDT_POD_WORKSPACES_DIR" in
  /*) ;;
  *)
    echo "[cindy-cloud] XDT_POD_WORKSPACES_DIR must be an absolute path" >&2
    exit 78
    ;;
esac
status_file="${CINDY_CLOUD_STATUS_FILE:-/var/lib/cindy/status/status.json}"
home_dir=/home/cindy
mkdir -p \
  "$(dirname "$status_file")" \
  "${XDT_USER_DATA_DIR:-/var/lib/cindy/user-data}" \
  "$XDT_POD_WORKSPACES_DIR" \
  "$home_dir"

# A mounted home subPath starts empty and hides the skeleton copied by useradd.
# Initialize it once without restoring root-owned directory metadata.
home_marker="$home_dir/.cindy-home-initialized"
if [ ! -e "$home_marker" ]; then
  if [ -z "$(find "$home_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    cp -R /etc/skel/. "$home_dir"/
  fi
  : > "$home_marker"
fi

# Never print secret contents. Missing native/runtime capabilities fail closed.
node /usr/local/bin/cindy-cloud-check-capabilities.mjs

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
  packaged_executable="${CINDY_CLOUD_PACKAGED_EXECUTABLE:-/opt/cindy/Cindy}"
  if [ ! -x "$packaged_executable" ]; then
    echo "[cindy-cloud] packaged runtime missing or not executable: $packaged_executable" >&2
    exit 78
  fi
  set -- "$packaged_executable" --headless
fi

"$@" &
child_pid=$!
set +e
wait "$child_pid"
exit_code=$?
set -e
cleanup
exit "$exit_code"
