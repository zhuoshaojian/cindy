"""Pack the browser build of the cloud pages for CIS (cloud-web.json pins the result).

Usage: python3 deploy/cloud-web/pack.py --source apps/desktop/.vite/cloud-web --output cloud-web.tar.gz

The archive is deterministic for the same build: sorted entries, zero timestamps and
owners, fixed modes, regular files and directories only. It records the source commit.
"""
import argparse
import gzip
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path


def entries(root: Path):
    for path in sorted(root.rglob('*')):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise SystemExit(f'UNSUPPORTED_ENTRY: {path.relative_to(root)}')
        yield path


def info(name: str, size: int = 0, directory: bool = False) -> tarfile.TarInfo:
    item = tarfile.TarInfo(name)
    item.mtime, item.uid, item.gid, item.uname, item.gname = 0, 0, 0, '', ''
    item.type = tarfile.DIRTYPE if directory else tarfile.REGTYPE
    item.mode = 0o755 if directory else 0o644
    item.size = size
    return item


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = args.source.resolve()
    if not (root / 'index.html').is_file():
        raise SystemExit('BUILD_MISSING: run `pnpm --filter desktop build:cloud-web` first')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    if subprocess.check_output(['git', 'status', '--porcelain', '--', 'apps', 'packages'], text=True).strip():
        raise SystemExit('SOURCE_DIRTY: build from a committed tree')
    manifest = json.dumps({'schemaVersion': 1, 'sourceCommit': commit}, indent=2).encode() + b'\n'
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w', format=tarfile.PAX_FORMAT) as tar:
        tar.addfile(info('cloud-web-source.json', len(manifest)), io.BytesIO(manifest))
        for path in entries(root):
            name = path.relative_to(root).as_posix()
            if path.is_dir():
                tar.addfile(info(name, directory=True))
            else:
                with path.open('rb') as handle:
                    tar.addfile(info(name, path.stat().st_size), handle)
    data = gzip.compress(raw.getvalue(), compresslevel=9, mtime=0)
    args.output.write_bytes(data)
    print(json.dumps({'sourceCommit': commit, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}))


if __name__ == '__main__':
    main()
