# Runtime programs

These tracked sources implement the existing non-root seccomp entry, health
probe, managed keyring checks and profile maintenance/preflight commands. Their
initial bytes are recorded in `source-sha256.json`; the source build installs
them directly and builds the context/wire bundles from the frozen client source.
No previous Cindy image supplies executable build inputs.

`chromium-compat` preserves `/usr/bin/chromium` for the frozen authorization
browser/CDP code while forwarding its unchanged arguments to the pinned Google
Chrome. The slim base removes only the duplicate Chromium packages. Sandbox
flags, private debugging pipes and authorization cleanup remain unchanged.

The healthcheck has two modes. With no argument it requires a fresh status for
this device, phase `ready` and all five components ready. Kubernetes startup
uses `--startup`: it also accepts a fresh `starting` status with binaries/maker
ready, explicit auth recovery `login-required`/`pending`, and a live owner-only
recovery socket. It does not make readiness pass or grant access before login.
Missing/stale status, stopping processes, broken initialization and missing or
unsafe recovery sockets still fail. The startup failure budget is unchanged.
Old images keep their strict check until upgraded; existing frozen CIS profiles
require an exact startup-template approval in addition to the image approval.
