#!/usr/bin/env python3
"""Build the planned release with upstream's own recipe.

Only the recipe's documented options are set: the pinned version and cloud revision, the
release commit, the native builder and its registry cache, and the download mirrors in
build-sources.json (the recipe still checks every checksum and signature).
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

from versioning import validate

HERE = Path(__file__).resolve().parent
# The recipe's mirrorable downloads (deploy/linux-desktop/build-image.py SOURCE_ARGS).
SOURCE_NAMES = {'DEBIAN_SNAPSHOT_URL', 'DEBIAN_BUILD_MIRROR', 'CHROME_DEB_URL', 'GH_TARBALL_URL',
                'PLANK_SOURCE_URL', 'PLANK_DEBIAN_SOURCE_URL'}
URL = re.compile(r'https://[^\s,]+')


def load_sources(path=HERE / 'build-sources.json'):
    value = json.loads(Path(path).read_text())
    if not isinstance(value, dict) or set(value) - SOURCE_NAMES:
        raise ValueError('INVALID_BUILD_SOURCES')
    for name, url in value.items():
        if not isinstance(url, str) or not URL.fullmatch(url):
            raise ValueError('INVALID_BUILD_SOURCE:' + name)
    return value


def command(upstream, plan, tag, builder, cache_repository, output, sources):
    version = validate(plan['version'])
    if plan['sourceCommit'] != version['upstreamCommit']:
        raise ValueError('PLAN_SOURCE_MISMATCH')
    return ['python3', str(Path(upstream) / 'deploy/linux-desktop/build-image.py'),
            '--version', version['upstreamVersion'], '--cloud-revision', str(version['cloudRevision']),
            '--revision', plan['sourceCommit'], '--tag', tag, '--builder', builder,
            '--cache-repository', cache_repository, '--output', str(output),
            *[f'--source-arg={name}={url}' for name, url in sorted(sources.items())]]


def build(upstream, plan, tag, builder, cache_repository, output, sources, run=subprocess.run):
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=upstream, text=True).strip()
    if head != plan['sourceCommit']:
        raise ValueError('UPSTREAM_CHECKOUT_MISMATCH')
    run(command(upstream, plan, tag, builder, cache_repository, output, sources), cwd=upstream, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--builder', required=True)
    parser.add_argument('--cache-repository', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    build(args.upstream.resolve(), json.loads(args.plan.read_text()), args.tag, args.builder,
          args.cache_repository, args.output.resolve(), load_sources())
