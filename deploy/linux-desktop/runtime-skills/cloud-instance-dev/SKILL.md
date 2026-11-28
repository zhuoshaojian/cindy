---
name: cloud-instance-dev
description: How to install software and use Docker on this Cindy cloud instance, which has no root access, no sudo, apt-get or pip, and system directories that cannot be written. Use it before installing any package, command-line tool, language runtime or runtime version, when sudo, apt-get, pip or a write under /usr fails, and before running docker, docker compose or docker build.
---

# Installing tools and using Docker on this cloud instance

There is no root access: `sudo`, `apt-get install` and writes under `/usr` fail, and `pip`
is not installed. Install into the home directory instead. It persists across restarts
and upgrades, and `~/.local/bin` and mise's shims come first on `PATH`.

## Installing tools

Check with `command -v` first. `git`, `curl`, `wget`, `gcc`, `g++`, `make`, `python3`,
`node`, `npm`, `gh`, `uv`, `uvx`, `mise`, `jq`, `rg` and the `docker` CLI are present.

- Python: use `uv`. `uv venv` and `uv pip install` for a project, `uv tool install <name>`
  or `uvx <name>` for command-line tools, `uv python install <version>` for another
  Python. `python3 -m venv` does not work here.
- Node.js: `npm install -g <package>` installs into `~/.local`; `npx <package>` runs one
  once. Use npm rather than pnpm for global installs.
- Other runtimes or versions (Go, Java, Rust, another Node or Python):
  `mise use -g <tool>@<version>`. Its shims are on `PATH`.
- Single programs: put them in `~/.local/bin` and `chmod +x` them. Downloads from GitHub
  releases can be very slow from this network; prefer PyPI, npm or mise when they offer
  the tool.
- Packages that exist only for apt: when Docker is available, run them in a Debian or
  Ubuntu container, where `apt-get install` works as root. Otherwise tell the user that
  the package cannot be installed on this instance; do not try `sudo` or edit system
  files.
- The home disk is limited. Check it with `df -h ~` and free space with `uv cache prune`,
  `npm cache clean --force` or `mise prune`.

## Docker

Check `DOCKER_HOST` first. When it is unset, this instance has no Docker: tell the user,
and do not try to install or start a Docker daemon. When it is set, the `docker` CLI
(with `docker compose` and `docker buildx`) uses the Docker service that the platform
runs for this instance.

- Mounts: bind mounts (`-v`, Compose `volumes:`) of paths under `/home/cindy`,
  `/var/lib/cindy` (including the task's working directory) and `/tmp` show the same
  files as the shell. Use `ls -A` before concluding that a mounted directory is empty;
  the home often holds only hidden entries.
- Ownership: containers run as root by default, so files they write into a mounted
  directory belong to root. Run tools that write into the project as the shell's user
  with `--user "$(id -u):$(id -g)"` (Compose: `user: "10001:10001"`). Remove root-owned
  leftovers through a container.
- Images: pulls from Docker Hub can be slow or fail from this network. Retry once. If it
  still fails, tell the user and ask which registry or mirror they trust, for example
  their organization's own; do not choose a third-party mirror yourself. After pulling
  from another registry, `docker tag` the image to the name that a Dockerfile or Compose
  file expects.
- DNS: containers on the default bridge network cannot resolve host names. Use a Compose
  project, a network from `docker network create`, or `--network host`. Ports published
  with `-p` are reachable on `localhost`.
- Data: images, containers, named volumes and build cache live on the instance's
  temporary disk, which `/tmp` shares, and are lost when the instance restarts or is
  upgraded. Keep what must survive, such as database files and build outputs, in bind
  mounts under `/home/cindy` or the task directory, not in named volumes. Check free
  space with `df -h /tmp` and remove unused images with `docker image prune`.
