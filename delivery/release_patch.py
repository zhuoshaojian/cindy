"""Reviewed patches to one upstream release, each pending in an upstream pull request.

An exception to building upstream as-is: used only when a release cannot build or start
in the cloud and the fixes are pending upstream. `release-patch.json` names the release
commit and, per patch, its diff, SHA-256, upstream pull request, reason and the exact files
it edits (existing files only). All patches go into one commit on the release with a fixed
identity, so the checks and build jobs compute the same commit; the plan and the candidate
records name it. A patch file for another release fails the plan: remove the files when
delivering a release that contains the fixes.
"""
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = HERE / 'release-patch.json'
KEYS = {'upstreamCommit', 'patches'}
PATCH_KEYS = {'file', 'sha256', 'upstreamPullRequest', 'reason', 'paths'}
_IDENTITY = {'NAME': 'Cindy cloud delivery', 'EMAIL': 'cloud-delivery@example.invalid', 'DATE': '1789344000 +0000'}
IDENTITY = {f'GIT_{role}_{key}': value for role in ('AUTHOR', 'COMMITTER') for key, value in _IDENTITY.items()}


def _path_ok(p):
    return isinstance(p, str) and p and not p.startswith('/') and '..' not in p.split('/') and '\\' not in p


def load(path=CONFIG):
    """The committed patches, or None when the release is built as-is."""
    path = Path(path)
    if not path.exists():
        return None
    value = json.loads(path.read_text())
    if (not isinstance(value, dict) or set(value) != KEYS
            or not isinstance(value['upstreamCommit'], str) or not re.fullmatch(r'[a-f0-9]{40}', value['upstreamCommit'])
            or not isinstance(value['patches'], list) or not value['patches']):
        raise ValueError('INVALID_RELEASE_PATCH')
    seen, patches = set(), []
    for patch in value['patches']:
        if (not isinstance(patch, dict) or set(patch) != PATCH_KEYS
                or not isinstance(patch['file'], str) or not re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.diff', patch['file'])
                or not isinstance(patch['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', patch['sha256'])
                or type(patch['upstreamPullRequest']) is not int or patch['upstreamPullRequest'] < 1
                or not isinstance(patch['reason'], str) or not patch['reason'].strip()
                or not isinstance(patch['paths'], list) or not patch['paths'] or not all(map(_path_ok, patch['paths']))
                or patch['paths'] != sorted(set(patch['paths'])) or seen & set(patch['paths'])):
            raise ValueError('INVALID_RELEASE_PATCH')
        seen |= set(patch['paths'])
        diff = (path.parent / patch['file']).read_bytes()
        if hashlib.sha256(diff).hexdigest() != patch['sha256']:
            raise ValueError('RELEASE_PATCH_DIGEST_MISMATCH')
        patches.append({**patch, 'diff': diff})
    return {'upstreamCommit': value['upstreamCommit'], 'patches': patches}


def _git(repo, *args, env=None, data=None):
    result = subprocess.run(['git', *args], cwd=repo, input=data, capture_output=True, check=True,
                            env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', **(env or {})})
    return result.stdout.decode().strip()


def apply(repo, release, upstream_commit):
    """Create the patched commit on `upstream_commit` without touching the checkout.

    Returns (commit, all edited paths). Missing file contents load on demand in partial clones.
    """
    if release['upstreamCommit'] != upstream_commit:
        raise ValueError('RELEASE_PATCH_FOR_ANOTHER_RELEASE')
    with tempfile.TemporaryDirectory() as temporary:
        index = {'GIT_INDEX_FILE': str(Path(temporary) / 'index')}
        _git(repo, 'read-tree', upstream_commit, env=index)
        for n, patch in enumerate(release['patches']):
            diff = Path(temporary) / f'{n}.diff'
            diff.write_bytes(patch['diff'])
            # Edits of existing files only: no created, deleted, renamed or re-moded paths.
            if _git(repo, 'apply', '--summary', str(diff)):
                raise ValueError('RELEASE_PATCH_CHANGES_FILE_SET')
            paths = sorted(line.split('\t', 2)[2] for line in _git(repo, 'apply', '--numstat', str(diff)).splitlines())
            if paths != patch['paths']:
                raise ValueError('RELEASE_PATCH_UNDECLARED_PATH')
            _git(repo, 'apply', '--cached', str(diff), env=index)
        tree = _git(repo, 'write-tree', env=index)
    lines = [f"- upstream pull request #{p['upstreamPullRequest']}, sha256 {p['sha256']}" for p in release['patches']]
    message = 'Cloud delivery patches for this release\n\n' + '\n'.join(lines) + '\n'
    commit = _git(repo, 'commit-tree', tree, '-p', upstream_commit, env=IDENTITY, data=message.encode())
    return commit, sorted(p for patch in release['patches'] for p in patch['paths'])


def verify(repo, commit, upstream_commit, paths):
    """The build's check of a planned patched commit: one commit on the release, declared files only."""
    if _git(repo, 'rev-parse', commit + '^') != upstream_commit:
        raise ValueError('RELEASE_PATCH_PARENT_MISMATCH')
    if sorted(_git(repo, 'diff', '--name-only', upstream_commit, commit).splitlines()) != sorted(paths):
        raise ValueError('RELEASE_PATCH_UNDECLARED_PATH')
