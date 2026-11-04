import hashlib
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

from install_git_lfs import install, MEMBER


class GitLfsInstallTest(unittest.TestCase):
    # Unit: CI's runner lacks LFS. The job installer must produce only the pinned
    # executable, never run install.sh/extract archive paths or accept corruption.
    # Existing Alibaba installer tests do not exercise this different tar layout.
    def archive(self, kind=tarfile.REGTYPE, duplicate=False):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as archive:
            item = tarfile.TarInfo(MEMBER); item.type = kind
            if kind == tarfile.REGTYPE:
                item.size = 3
                archive.addfile(item, io.BytesIO(b'bin'))
                if duplicate: archive.addfile(item, io.BytesIO(b'bin'))
            else:
                item.linkname = '/outside'; archive.addfile(item)
            # Docs/scripts are allowed in the upstream archive but never extracted.
            item = tarfile.TarInfo('../../outside'); item.size = 1
            archive.addfile(item, io.BytesIO(b'x'))
        return data.getvalue()

    def test_extracts_only_exact_regular_binary_without_hooks(self):
        data = self.archive()
        with tempfile.TemporaryDirectory() as root:
            target = install(data, Path(root)/'tools', hashlib.sha256(data).hexdigest())
            self.assertEqual(target.read_bytes(), b'bin')
            self.assertEqual(target.stat().st_mode & 0o777, 0o755)
            self.assertEqual([p.name for p in target.parent.iterdir()], ['git-lfs'])

    def test_rejects_checksum_before_creating_directory(self):
        with tempfile.TemporaryDirectory() as root:
            dest = Path(root)/'tools'
            with self.assertRaisesRegex(ValueError, 'CHECKSUM'):
                install(self.archive(), dest)
            self.assertFalse(dest.exists())

    def test_rejects_link_or_duplicate_executable(self):
        for data in [self.archive(tarfile.SYMTYPE), self.archive(duplicate=True)]:
            with tempfile.TemporaryDirectory() as root:
                dest = Path(root)/'tools'
                with self.assertRaisesRegex(ValueError, 'INVALID_ARCHIVE'):
                    install(data, dest, hashlib.sha256(data).hexdigest())
                self.assertFalse(dest.exists())


if __name__ == '__main__': unittest.main()
