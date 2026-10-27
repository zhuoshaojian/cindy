#!/usr/bin/env python3
"""Stage checksum-pinned Git LFS in one job; do not install hooks or global config."""
import argparse
import hashlib
import io
from pathlib import Path
import platform
import subprocess
import tarfile
import urllib.request

VERSION = '3.7.1'
# https://github.com/git-lfs/git-lfs/releases/tag/v3.7.1 (SHA-256 hashes)
URL = f'https://github.com/git-lfs/git-lfs/releases/download/v{VERSION}/git-lfs-linux-amd64-v{VERSION}.tar.gz'
SHA256 = '1c0b6ee5200ca708c5cebebb18fdeb0e1c98f1af5c1a9cba205a4c0ab5a5ec08'
MAX_BYTES = 64 * 1024 * 1024
MEMBER = f'git-lfs-{VERSION}/git-lfs'


def install(data, directory, expected=SHA256):
    if len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('GIT_LFS_CHECKSUM_MISMATCH')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        matches = [m for m in archive.getmembers() if m.name == MEMBER]
        if len(matches) != 1 or not matches[0].isfile() or matches[0].size > MAX_BYTES:
            raise ValueError('GIT_LFS_INVALID_ARCHIVE')
        binary = archive.extractfile(matches[0]).read()
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    target = directory / 'git-lfs'
    with target.open('xb') as out:
        out.write(binary)
    target.chmod(0o755)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        parser.error('GIT_LFS_REQUIRES_LINUX_AMD64')
    if not args.directory.is_absolute():
        parser.error('GIT_LFS_REQUIRES_ABSOLUTE_DIRECTORY')
    with urllib.request.urlopen(URL, timeout=60) as response:
        data = response.read(MAX_BYTES + 1)
    target = install(data, args.directory)
    result = subprocess.run([str(target), 'version'], capture_output=True, text=True, timeout=10, check=True)
    if not result.stdout.startswith(f'git-lfs/{VERSION} ('):
        raise ValueError('GIT_LFS_VERSION_MISMATCH')
    print(f'GIT_LFS_READY {VERSION}')


if __name__ == '__main__':
    main()
