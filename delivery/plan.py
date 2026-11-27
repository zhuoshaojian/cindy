#!/usr/bin/env python3
"""Validate the committed release identity against an upstream checkout and export a
credential-free delivery plan.

The image is built from upstream's own source and recipe at `upstreamCommit`; this branch
only adds delivery tools and build settings, so its commit names the delivery (sourceTag).
The one exception is committed release patches (release_patch.py): the source commit is then
those patches on the release, and the plan records them.
"""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

import release_patch
from versioning import COMMIT, cloud_version, image_tag, source_tag, load, require_successor

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
VERSION_PATH = 'delivery/version.json'
ELECTRON = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')


def git(*args, cwd=REPO):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()


def electron_version(upstream, commit):
    """The Electron the packaged native modules must load in, as the release pins it."""
    package = json.loads(git('show', commit + ':apps/desktop/package.json', cwd=upstream))
    version = {**package.get('dependencies', {}), **package.get('devDependencies', {})}.get('electron')
    if not isinstance(version, str) or not ELECTRON.fullmatch(version):
        raise ValueError('UPSTREAM_ELECTRON_VERSION_UNPINNED')
    return version


def plan(upstream, previous=None):
    value = load(HERE / 'version.json')
    tag = 'v' + value['upstreamVersion']
    if git('rev-parse', f'refs/tags/{tag}^{{commit}}', cwd=upstream) != value['upstreamCommit']:
        raise ValueError('UPSTREAM_TAG_COMMIT_MISMATCH')
    if git('rev-parse', 'HEAD', cwd=upstream) != value['upstreamCommit']:
        raise ValueError('UPSTREAM_CHECKOUT_MISMATCH')
    # A release from before the cloud recipe was merged upstream cannot be delivered.
    try:
        git('cat-file', '-e', value['upstreamCommit'] + ':deploy/linux-desktop/build-image.py', cwd=upstream)
    except subprocess.CalledProcessError:
        raise ValueError('UPSTREAM_RELEASE_HAS_NO_CLOUD_RECIPE') from None
    source, patched = value['upstreamCommit'], None
    release = release_patch.load()
    if release:
        source, paths = release_patch.apply(upstream, release, value['upstreamCommit'])
        patched = {'paths': paths, 'patches': [{k: p[k] for k in ('upstreamPullRequest', 'sha256', 'paths', 'reason')}
                                               for p in release['patches']]}
    changed = True
    if previous and previous != '0' * 40:
        if not COMMIT.fullmatch(previous):
            raise ValueError('PREVIOUS_MUST_BE_COMMIT_SHA')
        # Missing baseline objects are errors; only an absent file means first delivery.
        git('cat-file', '-e', previous + '^{commit}')
        files = git('ls-tree', '--name-only', previous, VERSION_PATH)
        if files:
            changed = require_successor(json.loads(git('show', previous + ':' + VERSION_PATH)), value)
    delivery = git('rev-parse', 'HEAD')
    return {'schemaVersion': 2, 'version': value, 'cloudVersion': cloud_version(value),
            'imageTag': image_tag(value), 'sourceTag': source_tag(delivery),
            'upstreamTag': tag, 'sourceCommit': source, 'releasePatch': patched, 'deliveryCommit': delivery,
            'electronVersion': electron_version(upstream, value['upstreamCommit']),
            'releaseChanged': changed, 'channel': 'candidate', 'releaseApproved': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', type=Path, required=True, help='checkout made by upstream.py')
    parser.add_argument('--previous')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = plan(args.upstream, args.previous)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
            out.write('changed=' + str(result['releaseChanged']).lower() + '\n')
            out.write('tag=' + result['imageTag'] + '\n')
