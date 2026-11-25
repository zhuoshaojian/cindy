import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

import build
import upstream
import upstream_fixture
from versioning import load

HERE = Path(__file__).resolve().parent
VERSION = {'schemaVersion': 1, 'upstreamVersion': '0.1.150', 'upstreamCommit': 'a'*40,
           'cloudRevision': 2, 'region': 'cn', 'platform': 'linux/amd64'}


class UpstreamCheckoutTest(unittest.TestCase):
    """Real Git against a local stand-in for the upstream repository."""

    def test_checks_out_exactly_the_tagged_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, _ = upstream_fixture.upstream(temporary)
            for history in (False, True):
                directory = Path(temporary) / f'checkout-{history}'
                value = {**VERSION, 'upstreamCommit': tagged}
                self.assertEqual(upstream.fetch(directory, value, url=origin.as_uri(), history=history), tagged)
                self.assertEqual(upstream_fixture.git(directory, 'rev-parse', 'HEAD'), tagged)
                self.assertTrue((directory / 'deploy/linux-desktop/build-image.py').is_file())
                # Only the release tag: no branch or other tag is taken as the release.
                self.assertEqual(upstream_fixture.git(directory, 'tag', '--list'), 'v0.1.150')
                self.assertEqual(upstream_fixture.git(directory, 'for-each-ref', 'refs/heads', 'refs/remotes'), '')

    def test_the_checks_job_writes_only_what_the_plan_reads(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, _ = upstream_fixture.upstream(temporary)
            upstream_fixture.commit(origin, {'apps/desktop/src/large.ts': 'x\n'}, 'more source')
            upstream_fixture.git(origin, 'tag', '-f', '-a', 'v0.1.150', '-m', 'release', 'HEAD')
            tagged = upstream_fixture.git(origin, 'rev-parse', 'HEAD')
            directory = Path(temporary) / 'checkout'
            upstream.fetch(directory, {**VERSION, 'upstreamCommit': tagged}, url=origin.as_uri(), files=upstream.PLAN_FILES)
            written = sorted(str(p.relative_to(directory)) for p in directory.rglob('*') if p.is_file() and '.git' not in p.parts)
            self.assertEqual(written, sorted(upstream.PLAN_FILES))
            self.assertEqual(upstream_fixture.git(directory, 'rev-parse', 'HEAD'), tagged)

    def test_a_tag_that_names_another_commit_is_not_the_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, _, later = upstream_fixture.upstream(temporary)
            with self.assertRaisesRegex(ValueError, 'UPSTREAM_TAG_COMMIT_MISMATCH'):
                upstream.fetch(Path(temporary) / 'checkout', {**VERSION, 'upstreamCommit': later}, url=origin.as_uri())

    def test_never_reuses_a_directory_with_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, _ = upstream_fixture.upstream(temporary)
            directory = Path(temporary) / 'checkout'
            directory.mkdir()
            (directory / 'stale').write_text('x')
            with self.assertRaisesRegex(ValueError, 'NOT_EMPTY'):
                upstream.fetch(directory, {**VERSION, 'upstreamCommit': tagged}, url=origin.as_uri())

    def test_release_tag_follows_the_committed_version(self):
        self.assertEqual(upstream.release_tag(VERSION), 'v0.1.150')
        self.assertEqual(upstream.release_tag(load(HERE / 'version.json')), 'v' + load(HERE / 'version.json')['upstreamVersion'])


class RecipeBuildTest(unittest.TestCase):
    plan = {'version': VERSION, 'sourceCommit': 'a'*40}

    def test_runs_the_upstream_recipe_with_only_its_documented_options(self):
        sources = {'PLANK_SOURCE_URL': 'https://mirror.example.invalid/plank.tar.xz',
                   'DEBIAN_BUILD_MIRROR': 'https://mirror.example.invalid'}
        command = build.command('/work/upstream', self.plan, 'cindy-ci:0.1.150-cloud.2-cn-amd64', 'builder-1',
                                'registry.example.invalid/cache/runtime', Path('/work/out'), sources)
        self.assertEqual(command, [
            'python3', '/work/upstream/deploy/linux-desktop/build-image.py',
            '--version', '0.1.150', '--cloud-revision', '2', '--revision', 'a'*40,
            '--tag', 'cindy-ci:0.1.150-cloud.2-cn-amd64', '--builder', 'builder-1',
            '--cache-repository', 'registry.example.invalid/cache/runtime', '--output', '/work/out',
            '--source-arg=DEBIAN_BUILD_MIRROR=https://mirror.example.invalid',
            '--source-arg=PLANK_SOURCE_URL=https://mirror.example.invalid/plank.tar.xz'])

    def test_plan_must_name_the_committed_release(self):
        with self.assertRaisesRegex(ValueError, 'PLAN_SOURCE_MISMATCH'):
            build.command('/u', {**self.plan, 'sourceCommit': 'b'*40}, 't:x', 'b', 'r/c', Path('/o'), {})

    def test_builds_only_in_a_checkout_of_that_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, _ = upstream_fixture.upstream(temporary)
            directory = Path(temporary) / 'checkout'
            value = {**VERSION, 'upstreamCommit': tagged}
            upstream.fetch(directory, value, url=origin.as_uri())
            run = MagicMock()
            build.build(directory, {'version': value, 'sourceCommit': tagged}, 't:x', 'b', 'r/c', Path('/o'), {}, run=run)
            self.assertEqual(run.call_args.kwargs, {'cwd': directory, 'check': True})
            run.reset_mock()
            other = {**value, 'upstreamCommit': 'c'*40}
            with self.assertRaisesRegex(ValueError, 'UPSTREAM_CHECKOUT_MISMATCH'):
                build.build(directory, {'version': other, 'sourceCommit': 'c'*40}, 't:x', 'b', 'r/c', Path('/o'), {}, run=run)
            run.assert_not_called()

    def test_committed_mirrors_are_https_downloads_the_recipe_accepts(self):
        sources = build.load_sources()
        self.assertTrue(sources)
        self.assertLessEqual(set(sources), build.SOURCE_NAMES)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'sources.json'
            for value in ({'UNKNOWN_URL': 'https://x.invalid'}, {'DEBIAN_BUILD_MIRROR': 'http://x.invalid'},
                          {'DEBIAN_BUILD_MIRROR': 'https://x.invalid a'}, ['https://x.invalid']):
                path.write_text(json.dumps(value))
                with self.subTest(value=value), self.assertRaises(ValueError):
                    build.load_sources(path)


if __name__ == '__main__':
    unittest.main()
