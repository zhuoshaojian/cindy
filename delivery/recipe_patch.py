"""A reviewed patch to upstream's cloud recipe, for exactly one release.

An exception to building upstream as-is: used only when a release's own recipe cannot build
and the same change is pending upstream. `recipe-patch.json` names the release commit, the
upstream pull request and the diff's SHA-256. The diff may only edit existing files under
deploy/linux-desktop/. The patched commit has a fixed identity, so the checks and build jobs
compute the same commit, and the build records name it. A patch for another release fails the
plan: remove both files when delivering a release that contains the change.
"""
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = HERE / 'recipe-patch.json'
KEYS = {'upstreamCommit', 'file', 'sha256', 'upstreamPullRequest', 'reason'}
PREFIX = 'deploy/linux-desktop/'
_IDENTITY = {'NAME': 'Cindy cloud delivery', 'EMAIL': 'cloud-delivery@example.invalid', 'DATE': '1789344000 +0000'}
IDENTITY = {f'GIT_{role}_{key}': value for role in ('AUTHOR', 'COMMITTER') for key, value in _IDENTITY.items()}


def load(path=CONFIG):
    """The committed patch, or None when the release is built as-is."""
    path = Path(path)
    if not path.exists():
        return None
    value = json.loads(path.read_text())
    if (not isinstance(value, dict) or set(value) != KEYS
            or not isinstance(value['upstreamCommit'], str) or not re.fullmatch(r'[a-f0-9]{40}', value['upstreamCommit'])
            or not isinstance(value['file'], str) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.diff', value['file'])
            or not isinstance(value['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', value['sha256'])
            or type(value['upstreamPullRequest']) is not int or value['upstreamPullRequest'] < 1
            or not isinstance(value['reason'], str) or not value['reason'].strip()):
        raise ValueError('INVALID_RECIPE_PATCH')
    diff = (path.parent / value['file']).read_bytes()
    if hashlib.sha256(diff).hexdigest() != value['sha256']:
        raise ValueError('RECIPE_PATCH_DIGEST_MISMATCH')
    return {**value, 'diff': diff}


def _git(repo, *args, env=None, data=None):
    result = subprocess.run(['git', *args], cwd=repo, input=data, capture_output=True, check=True,
                            env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', **(env or {})})
    return result.stdout.decode().strip()


def apply(repo, patch, upstream_commit):
    """Create the patched commit on `upstream_commit` without touching the checkout.

    Returns (commit, edited paths). Missing file contents load on demand in partial clones.
    """
    if patch['upstreamCommit'] != upstream_commit:
        raise ValueError('RECIPE_PATCH_FOR_ANOTHER_RELEASE')
    with tempfile.TemporaryDirectory() as temporary:
        diff = Path(temporary) / 'recipe.diff'
        diff.write_bytes(patch['diff'])
        # Edits of existing recipe files only: no created, deleted, renamed or re-moded paths.
        if _git(repo, 'apply', '--summary', str(diff)):
            raise ValueError('RECIPE_PATCH_CHANGES_FILE_SET')
        paths = [line.split('\t', 2)[2] for line in _git(repo, 'apply', '--numstat', str(diff)).splitlines()]
        if not paths or any(not p.startswith(PREFIX) or '..' in p.split('/') for p in paths):
            raise ValueError('RECIPE_PATCH_OUTSIDE_RECIPE')
        index = {'GIT_INDEX_FILE': str(Path(temporary) / 'index')}
        _git(repo, 'read-tree', upstream_commit, env=index)
        _git(repo, 'apply', '--cached', str(diff), env=index)
        tree = _git(repo, 'write-tree', env=index)
    message = (f"Cloud recipe patch from upstream pull request #{patch['upstreamPullRequest']}\n\n"
               f"sha256 {patch['sha256']}\n")
    commit = _git(repo, 'commit-tree', tree, '-p', upstream_commit, env=IDENTITY, data=message.encode())
    return commit, sorted(paths)


def verify(repo, commit, upstream_commit, paths):
    """The build's check of a planned patched commit: one recipe-only commit on the release."""
    if _git(repo, 'rev-parse', commit + '^') != upstream_commit:
        raise ValueError('RECIPE_PATCH_PARENT_MISMATCH')
    changed = sorted(_git(repo, 'diff', '--name-only', upstream_commit, commit).splitlines())
    if changed != sorted(paths) or any(not p.startswith(PREFIX) for p in changed):
        raise ValueError('RECIPE_PATCH_OUTSIDE_RECIPE')
