import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import build
import release_patch
import upstream
import upstream_fixture
from plan import plan

VERSION = {'schemaVersion': 1, 'upstreamVersion': '0.1.150', 'upstreamCommit': 'a'*40,
           'cloudRevision': 2, 'region': 'cn', 'platform': 'linux/amd64'}
RECIPE = 'deploy/linux-desktop/build-image.py'
NEW = 'deploy/linux-desktop/new.py'
CLIENT = 'apps/desktop/package.json'
RECIPE_EDIT = (f'diff --git a/{RECIPE} b/{RECIPE}\n--- a/{RECIPE}\n+++ b/{RECIPE}\n'
               '@@ -1 +1 @@\n-print("recipe")\n+print("patched recipe")\n')
CLIENT_EDIT = (f'diff --git a/{CLIENT} b/{CLIENT}\n--- a/{CLIENT}\n+++ b/{CLIENT}\n@@ -1 +1 @@\n'
               '-{"devDependencies": {"electron": "42.11.12"}}\n\\ No newline at end of file\n'
               '+{"devDependencies": {"electron": "42.11.12"}, "patched": true}\n\\ No newline at end of file\n')
CREATE = f'diff --git a/{NEW} b/{NEW}\nnew file mode 100644\n--- /dev/null\n+++ b/{NEW}\n@@ -0,0 +1 @@\n+x\n'
CREATE_EXECUTABLE = CREATE.replace('100644', '100755')
DELETE = f'diff --git a/{RECIPE} b/{RECIPE}\ndeleted file mode 100644\n--- a/{RECIPE}\n+++ /dev/null\n@@ -1 +0,0 @@\n-print("recipe")\n'
MODE = f'diff --git a/{RECIPE} b/{RECIPE}\nold mode 100644\nnew mode 100755\n'


def committed(directory, release, patches=None, **top):
    """release-patch.json and its diffs as they would be committed on the delivery branch."""
    entries = []
    for n, (diff, paths, pr) in enumerate(patches or [(RECIPE_EDIT, [RECIPE], 13422), (CREATE, [NEW], 13423)]):
        (Path(directory) / f'p{n}.diff').write_text(diff)
        entries.append({'file': f'p{n}.diff', 'sha256': hashlib.sha256(diff.encode()).hexdigest(),
                        'upstreamPullRequest': pr, 'reason': 'release cannot build or start', 'paths': paths})
    path = Path(directory) / 'release-patch.json'
    path.write_text(json.dumps({'upstreamCommit': release, 'patches': entries, **top}))
    return path


class ReleasePatchTest(unittest.TestCase):
    def release(self, temporary):
        origin, tagged, _ = upstream_fixture.upstream(temporary)
        return origin, tagged, {**VERSION, 'upstreamCommit': tagged}

    def test_without_committed_patches_the_release_is_built_as_is(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.assertIsNone(release_patch.load(Path(temporary) / 'release-patch.json'))

    def test_checks_and_build_jobs_compute_the_same_commit_of_declared_files_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, value = self.release(temporary)
            loaded = release_patch.load(committed(temporary, tagged))
            sparse, full = Path(temporary) / 'checks', Path(temporary) / 'build'
            upstream.fetch(sparse, value, url=origin.as_uri(), files=upstream.PLAN_FILES)
            upstream.fetch(full, value, url=origin.as_uri(), history=True)
            first, paths = release_patch.apply(sparse, loaded, tagged)
            self.assertEqual(release_patch.apply(full, loaded, tagged), (first, sorted([NEW, RECIPE])))
            # The checkout is untouched; the commit is the release plus the declared edits only.
            self.assertEqual(upstream_fixture.git(full, 'rev-parse', 'HEAD'), tagged)
            self.assertEqual(upstream_fixture.git(full, 'rev-parse', first + '^'), tagged)
            self.assertEqual(upstream_fixture.git(full, 'diff', '--name-only', tagged, first).splitlines(), sorted([NEW, RECIPE]))
            self.assertEqual(upstream_fixture.git(full, 'show', f'{first}:{RECIPE}'), 'print("patched recipe")')
            self.assertEqual(upstream_fixture.git(full, 'ls-tree', first, NEW).split()[0], '100644')
            message = upstream_fixture.git(full, 'log', '-1', '--format=%B', first)
            self.assertIn('#13422', message)
            self.assertIn('#13423', message)

    def test_rejects_changed_diffs_other_releases_client_and_undeclared_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, value = self.release(temporary)
            directory = Path(temporary) / 'checkout'
            upstream.fetch(directory, value, url=origin.as_uri(), history=True)
            path = committed(temporary, tagged)
            (Path(temporary) / 'p0.diff').write_text(RECIPE_EDIT.replace('patched', 'other'))
            with self.assertRaisesRegex(ValueError, 'DIGEST_MISMATCH'):
                release_patch.load(path)
            with self.assertRaisesRegex(ValueError, 'FOR_ANOTHER_RELEASE'):
                release_patch.apply(directory, release_patch.load(committed(temporary, 'b'*40)), tagged)
            # A patch declared as recipe-only that edits the client, and file set changes other than new regular files.
            cases = [([(CLIENT_EDIT, [RECIPE], 1)], 'UNDECLARED_PATH'), ([(CREATE, [RECIPE], 1)], 'UNDECLARED_PATH'),
                     ([(CREATE_EXECUTABLE, [NEW], 1)], 'CHANGES_FILE_SET'), ([(DELETE, [RECIPE], 1)], 'CHANGES_FILE_SET'),
                     ([(MODE, [RECIPE], 1)], 'CHANGES_FILE_SET')]
            for patches, error in cases:
                with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                    release_patch.apply(directory, release_patch.load(committed(temporary, tagged, patches)), tagged)
            empty = Path(temporary) / 'empty.json'
            empty.write_text(json.dumps({'upstreamCommit': tagged, 'patches': []}))
            for broken in [empty, committed(temporary, tagged, extra=1)]:
                with self.subTest(broken=broken.name), self.assertRaisesRegex(ValueError, 'INVALID_RELEASE_PATCH'):
                    release_patch.load(broken)
            # Paths outside the recipe, the client included, are refused before anything is applied.
            for patches in [[(RECIPE_EDIT, ['../x'], 1)], [(RECIPE_EDIT, [RECIPE], '1')], [(CLIENT_EDIT, [CLIENT], 1)],
                            [(RECIPE_EDIT, ['deploy/linux-desktop/../../x'], 1)],
                            [(RECIPE_EDIT, [RECIPE], 1), (RECIPE_EDIT, [RECIPE], 2)],
                            [(RECIPE_EDIT, [RECIPE], 0)], [(RECIPE_EDIT, [RECIPE], True)]]:
                with self.subTest(patches=[p[1:] for p in patches]), self.assertRaisesRegex(ValueError, 'INVALID_RELEASE_PATCH'):
                    release_patch.load(committed(temporary, tagged, patches))

    def test_a_change_verified_before_its_pull_request_is_recorded_as_not_yet_proposed(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, value = self.release(temporary)
            loaded = release_patch.load(committed(temporary, tagged, [(RECIPE_EDIT, [RECIPE], 13422), (CREATE, [NEW], None)]))
            directory = Path(temporary) / 'build'
            upstream.fetch(directory, value, url=origin.as_uri(), history=True)
            commit, paths = release_patch.apply(directory, loaded, tagged)
            self.assertEqual(paths, sorted([NEW, RECIPE]))
            message = upstream_fixture.git(directory, 'log', '-1', '--format=%B', commit)
            self.assertIn('upstream pull request #13422', message)
            self.assertIn('upstream pull request not yet proposed', message)
            with patch('plan.load', return_value=value), patch('release_patch.load', return_value=loaded):
                planned = plan(directory)
            self.assertEqual(planned['sourceCommit'], commit)
            self.assertEqual([p['upstreamPullRequest'] for p in planned['releasePatch']['patches']], [13422, None])

    def test_the_plan_names_the_patched_commit_and_records_every_patch(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, value = self.release(temporary)
            loaded = release_patch.load(committed(temporary, tagged))
            results = []
            for name, kwargs in [('checks', {'files': upstream.PLAN_FILES}), ('build', {'history': True})]:
                directory = Path(temporary) / name
                upstream.fetch(directory, value, url=origin.as_uri(), **kwargs)
                with patch('plan.load', return_value=value), patch('release_patch.load', return_value=loaded):
                    results.append(plan(directory))
            checks, built = results
            self.assertEqual(checks['sourceCommit'], built['sourceCommit'])
            self.assertNotEqual(built['sourceCommit'], tagged)
            self.assertEqual(built['releasePatch']['paths'], sorted([NEW, RECIPE]))
            self.assertEqual([p['upstreamPullRequest'] for p in built['releasePatch']['patches']], [13422, 13423])
            self.assertEqual(built['version']['upstreamCommit'], tagged)
            self.assertEqual(built['electronVersion'], '42.11.12')

    def test_build_checks_out_only_the_planned_patches_of_this_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, value = self.release(temporary)
            loaded = release_patch.load(committed(temporary, tagged))
            directory = Path(temporary) / 'build'
            upstream.fetch(directory, value, url=origin.as_uri(), history=True)
            with patch('plan.load', return_value=value), patch('release_patch.load', return_value=loaded):
                planned = plan(directory)
            run = MagicMock()
            # A planned commit that is not the release plus the declared edits is refused before any build.
            for forged in [{**planned, 'sourceCommit': upstream_fixture.git(directory, 'rev-parse', tagged + '^{tree}')},
                           {**planned, 'releasePatch': {**planned['releasePatch'], 'paths': [RECIPE]}}]:
                with self.subTest(forged=list(forged)), self.assertRaises(Exception):
                    build.build(directory, forged, 't:x', 'b', 'r/c', Path('/o'), {}, run=run)
            run.assert_not_called()
            build.build(directory, planned, 't:x', 'b', 'r/c', Path('/o'), {}, run=run)
            self.assertEqual(upstream_fixture.git(directory, 'rev-parse', 'HEAD'), planned['sourceCommit'])
            self.assertIn(planned['sourceCommit'], run.call_args.args[0])
            # Without recorded patches the source must be the release itself, and vice versa.
            with self.assertRaisesRegex(ValueError, 'PLAN_SOURCE_MISMATCH'):
                build.command('/u', {**planned, 'releasePatch': None}, 't:x', 'b', 'r/c', Path('/o'), {})
            with self.assertRaisesRegex(ValueError, 'PLAN_SOURCE_MISMATCH'):
                build.command('/u', {**planned, 'sourceCommit': tagged}, 't:x', 'b', 'r/c', Path('/o'), {})


if __name__ == '__main__':
    unittest.main()
