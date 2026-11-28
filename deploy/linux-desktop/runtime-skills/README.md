# Agent Skills

Skills that only cloud instances get. `../assemble-runtime.py` installs this directory
to `/usr/local/share/cindy/agent-skills/`, and `xfce-session` runs
`apply-agent-skills.py` before Cindy starts; a failure there does not stop the desktop.
The system prompt is not changed.

- `cloud-instance-dev/SKILL.md`: installing tools without root, and using Docker when the
  platform provides it (`DOCKER_HOST` set).

Each Skill is one `SKILL.md`, copied to `~/.agents/skills/<name>/`. Codex and Pi read that
folder; Cindy links its entries into `~/.claude/skills/` when its Claude projection rules
allow. The copy holds `.cindy-cloud-skill.json` with the SHA-256 of what was written, and
`~/.config/cindy-desktop/agent-skills.json` lists the Skills written to this home. On
every start, a Skill that is

- missing and was never written here is written;
- an unchanged copy of another version is replaced by this image's version;
- an edited copy, or a same-name folder, link or file without the marker, is left alone;
- deleted after it was written is not written again. Remove its name from the list to
  get it back.

Removing or renaming a Skill here leaves existing copies in place.

```sh
python3 -m unittest discover -s deploy/linux-desktop/runtime-skills -p 'test_*.py'
```
