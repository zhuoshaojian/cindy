import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import build
import recipe_patch
import upstream
import upstream_fixture
from plan import plan

VERSION = {'schemaVersion': 1, 'upstreamVersion': '0.1.150', 'upstreamCommit': 'a'*40,
           'cloudRevision': 2, 'region': 'cn', 'platform': 'linux/amd64'}
RECIPE = 'deploy/linux-desktop/build-image.py'
EDIT = (f'diff --git a/{RECIPE} b/{RECIPE}\n--- a/{RECIPE}\n+++ b/{RECIPE}\n'
        '@@ -1 +1 @@\n-print("recipe")\n+print("patched recipe")\n')
OUTSIDE = ('diff --git a/apps/desktop/main.ts b/apps/desktop/main.ts\n--- a/apps/desktop/main.ts\n'
           '+++ b/apps/desktop/main.ts\n@@ -1 +1 @@\n-a\n+b\n')
CREATE = ('diff --git a/deploy/linux-desktop/new.py b/deploy/linux-desktop/new.py\nnew file mode 100644\n'
          '--- /dev/null\n+++ b/deploy/linux-desktop/new.py\n@@ -0,0 +1 @@\n+x\n')


def committed(directory, release, diff=EDIT, **overrides):
    """recipe-patch.json and its diff as they would be committed on the delivery branch."""
    (Path(directory) / 'recipe.diff').write_text(diff)
    value = {'upstreamCommit': release, 'file': 'recipe.diff', 'sha256': hashlib.sha256(diff.encode()).hexdigest(),
             'upstreamPullRequest': 13422, 'reason': 'release recipe cannot build', **overrides}
    path = Path(directory) / 'recipe-patch.json'
    path.write_text(json.dumps(value))
    return path


class RecipePatchTest(unittest.TestCase):
    def release(self, temporary):
        origin, tagged, _ = upstream_fixture.upstream(temporary)
        return origin, tagged, {**VERSION, 'upstreamCommit': tagged}

    def test_without_a_committed_patch_the_release_is_built_as_is(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.assertIsNone(recipe_patch.load(Path(temporary) / 'recipe-patch.json'))

    def test_checks_and_build_jobs_compute_the_same_recipe_only_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, value = self.release(temporary)
            loaded = recipe_patch.load(committed(temporary, tagged))
            sparse, full = Path(temporary) / 'checks', Path(temporary) / 'build'
            upstream.fetch(sparse, value, url=origin.as_uri(), files=upstream.PLAN_FILES)
            upstream.fetch(full, value, url=origin.as_uri(), history=True)
            first, paths = recipe_patch.apply(sparse, loaded, tagged)
            self.assertEqual(recipe_patch.apply(full, loaded, tagged), (first, [RECIPE]))
            self.assertEqual(paths, [RECIPE])
            # The checkout is untouched; the commit is the release plus the recipe edit only.
            self.assertEqual(upstream_fixture.git(full, 'rev-parse', 'HEAD'), tagged)
            self.assertEqual(upstream_fixture.git(full, 'rev-parse', first + '^'), tagged)
            self.assertEqual(upstream_fixture.git(full, 'diff', '--name-only', tagged, first), RECIPE)
            self.assertEqual(upstream_fixture.git(full, 'show', f'{first}:{RECIPE}'), 'print("patched recipe")')
            self.assertIn('#13422', upstream_fixture.git(full, 'log', '-1', '--format=%B', first))

    def test_rejects_a_changed_diff_another_release_and_edits_outside_the_recipe(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, value = self.release(temporary)
            directory = Path(temporary) / 'checkout'
            upstream.fetch(directory, value, url=origin.as_uri(), history=True)
            path = committed(temporary, tagged)
            (Path(temporary) / 'recipe.diff').write_text(EDIT.replace('patched', 'other'))
            with self.assertRaisesRegex(ValueError, 'DIGEST_MISMATCH'):
                recipe_patch.load(path)
            with self.assertRaisesRegex(ValueError, 'FOR_ANOTHER_RELEASE'):
                recipe_patch.apply(directory, recipe_patch.load(committed(temporary, 'b'*40)), tagged)
            for diff, error in [(OUTSIDE, 'OUTSIDE_RECIPE'), (CREATE, 'CHANGES_FILE_SET')]:
                with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                    recipe_patch.apply(directory, recipe_patch.load(committed(temporary, tagged, diff)), tagged)
            for broken in [{'upstreamPullRequest': '13422'}, {'reason': ' '}, {'file': '../x.diff'}, {'extra': 1}]:
                with self.subTest(broken=broken), self.assertRaisesRegex(ValueError, 'INVALID_RECIPE_PATCH'):
                    recipe_patch.load(committed(temporary, tagged, **broken))

    def test_the_plan_names_the_patched_commit_and_records_the_exception(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, value = self.release(temporary)
            loaded = recipe_patch.load(committed(temporary, tagged))
            results = []
            for name, kwargs in [('checks', {'files': upstream.PLAN_FILES}), ('build', {'history': True})]:
                directory = Path(temporary) / name
                upstream.fetch(directory, value, url=origin.as_uri(), **kwargs)
                with patch('plan.load', return_value=value), patch('recipe_patch.load', return_value=loaded):
                    results.append(plan(directory))
            checks, built = results
            self.assertEqual(checks['sourceCommit'], built['sourceCommit'])
            self.assertNotEqual(built['sourceCommit'], tagged)
            self.assertEqual(built['recipePatch'], {'upstreamPullRequest': 13422, 'sha256': loaded['sha256'],
                                                    'paths': [RECIPE], 'reason': 'release recipe cannot build'})
            self.assertEqual(built['version']['upstreamCommit'], tagged)
            self.assertEqual(built['electronVersion'], '42.11.12')

    def test_build_checks_out_only_the_planned_patch_of_this_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            origin, tagged, value = self.release(temporary)
            loaded = recipe_patch.load(committed(temporary, tagged))
            directory = Path(temporary) / 'build'
            upstream.fetch(directory, value, url=origin.as_uri(), history=True)
            with patch('plan.load', return_value=value), patch('recipe_patch.load', return_value=loaded):
                planned = plan(directory)
            # A planned commit that is not the release plus the recipe edit is refused before any build.
            forged = {**planned, 'sourceCommit': upstream_fixture.git(directory, 'rev-parse', tagged + '^{tree}')}
            run = MagicMock()
            with self.assertRaises(Exception):
                build.build(directory, forged, 't:x', 'b', 'r/c', Path('/o'), {}, run=run)
            run.assert_not_called()
            build.build(directory, planned, 't:x', 'b', 'r/c', Path('/o'), {}, run=run)
            self.assertEqual(upstream_fixture.git(directory, 'rev-parse', 'HEAD'), planned['sourceCommit'])
            self.assertIn(planned['sourceCommit'], run.call_args.args[0])
            # Without a recorded patch the source must be the release itself, and vice versa.
            with self.assertRaisesRegex(ValueError, 'PLAN_SOURCE_MISMATCH'):
                build.command('/u', {**planned, 'recipePatch': None}, 't:x', 'b', 'r/c', Path('/o'), {})
            with self.assertRaisesRegex(ValueError, 'PLAN_SOURCE_MISMATCH'):
                build.command('/u', {**planned, 'sourceCommit': tagged}, 't:x', 'b', 'r/c', Path('/o'), {})


if __name__ == '__main__':
    unittest.main()
