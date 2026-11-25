#!/usr/bin/env python3
"""Check out the pinned upstream release into a new directory.

The release tag must point at the committed upstreamCommit. `--history` fetches every
ancestor's commits and trees (file contents load on demand), which the recipe needs to
find the commit that last changed its base inputs; without it only the release commit is
fetched. `--plan-only` checks out just the files the plan reads, for the checks job.
"""
import argparse
import os
import subprocess
from pathlib import Path

from versioning import load

HERE = Path(__file__).resolve().parent
UPSTREAM = 'https://github.com/makecindy/cindy.git'
# What plan.py reads from the release (it uses Git objects for the rest).
PLAN_FILES = ('apps/desktop/package.json', 'deploy/linux-desktop/build-image.py')


def git(directory, *args):
    # Large files stay pointers here; the recipe resolves the ones it packages itself.
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_LFS_SKIP_SMUDGE': '1'}
    return subprocess.check_output(['git', '-c', 'advice.detachedHead=false', *args], cwd=directory, text=True,
                                   env=env).strip()


def release_tag(value):
    return 'v' + value['upstreamVersion']


def fetch(directory, value, url=UPSTREAM, history=False, files=None):
    directory = Path(directory)
    if directory.exists() and any(directory.iterdir()):
        raise ValueError('UPSTREAM_DIRECTORY_NOT_EMPTY')
    directory.mkdir(parents=True, exist_ok=True)
    tag = release_tag(value)
    git(directory, 'init', '-q')
    git(directory, 'remote', 'add', 'origin', url)
    depth = [] if history else ['--depth=1']
    # Only this tag: never infer the release from a branch or another tag.
    git(directory, 'fetch', '-q', '--no-tags', '--filter=blob:none', *depth, 'origin',
        f'+refs/tags/{tag}:refs/tags/{tag}')
    commit = git(directory, 'rev-parse', f'refs/tags/{tag}^{{commit}}')
    if commit != value['upstreamCommit']:
        raise ValueError('UPSTREAM_TAG_COMMIT_MISMATCH')
    if files is not None:
        # Only these paths are written (and their contents downloaded).
        git(directory, 'sparse-checkout', 'set', '--no-cone', *files)
    git(directory, 'checkout', '-q', '--detach', commit)
    if git(directory, 'rev-parse', 'HEAD') != commit:
        raise ValueError('UPSTREAM_CHECKOUT_MISMATCH')
    return commit


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--history', action='store_true', help='for the build: every ancestor commit')
    mode.add_argument('--plan-only', action='store_true', help='for the checks: only the files plan.py reads')
    args = parser.parse_args()
    print(fetch(args.directory, load(HERE / 'version.json'), history=args.history,
                files=PLAN_FILES if args.plan_only else None))
