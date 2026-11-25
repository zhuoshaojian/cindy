"""A tiny local stand-in for the upstream repository: real Git, no network."""
import json
import os
import subprocess
from pathlib import Path

ENV = {**os.environ, 'GIT_AUTHOR_NAME': 'Fixture', 'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
       'GIT_COMMITTER_NAME': 'Fixture', 'GIT_COMMITTER_EMAIL': 'fixture@example.invalid',
       'GIT_CONFIG_NOSYSTEM': '1', 'GIT_TERMINAL_PROMPT': '0'}


def git(repo, *args):
    return subprocess.check_output(['git', *args], cwd=repo, text=True, env=ENV).strip()


def commit(repo, files, message):
    for name, content in files.items():
        path = Path(repo) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', message)
    return git(repo, 'rev-parse', 'HEAD')


def upstream(root, version='0.1.150', electron='42.11.12', recipe=True):
    """A repository whose `v<version>` tag is an annotated release tag. Returns (repo, tagged commit, later commit)."""
    repo = Path(root) / 'upstream-origin'
    repo.mkdir()
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'uploadpack.allowFilter', 'true')
    git(repo, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
    files = {'apps/desktop/package.json': json.dumps({'devDependencies': {'electron': electron}})}
    if recipe:
        files['deploy/linux-desktop/build-image.py'] = 'print("recipe")\n'
    tagged = commit(repo, files, 'release')
    git(repo, 'tag', '-a', 'v' + version, '-m', 'release ' + version)
    later = commit(repo, {'README.md': 'after the release\n'}, 'later')
    return repo, tagged, later
