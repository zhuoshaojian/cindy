import copy
import importlib.util
import json
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from versioning import load, cloud_version, image_tag, source_tag, version_key, require_successor, require_same_release, validate
from publish import publish_tags, publish, registry_manifest, check_build
from plan import plan, git as delivery_git
import upstream as upstream_checkout
import upstream_fixture

HERE = Path(__file__).resolve().parent
ACTUAL = load(HERE / 'version.json')
VERSION = {'schemaVersion': 1, 'upstreamVersion': '0.1.108', 'upstreamCommit': 'a'*40,
           'cloudRevision': 1, 'region': 'cn', 'platform': 'linux/amd64'}

class VersionTest(unittest.TestCase):
    def test_full_upstream_version_and_numeric_cloud_order(self):
        self.assertEqual(cloud_version(VERSION), '0.1.108-cloud.1')
        self.assertEqual(image_tag(VERSION), '0.1.108-cloud.1-cn-amd64')
        self.assertGreater(version_key({**VERSION, 'cloudRevision': 10}), version_key({**VERSION, 'cloudRevision': 9}))
        self.assertGreater(version_key({**VERSION, 'upstreamVersion': '0.1.109'}), version_key({**VERSION, 'cloudRevision': 100}))

    def test_rejects_misleading_or_unsafe_versions(self):
        for key, value in [('upstreamVersion', '0.1'), ('upstreamVersion', '0.01.108'), ('upstreamVersion', '0.1.108-cloud.1'),
                           ('cloudRevision', True), ('cloudRevision', '2'), ('cloudRevision', 0),
                           ('region', 'global'), ('platform', 'linux/arm64'), ('upstreamCommit', 'main')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                validate({**VERSION, key: value})
        with self.assertRaises(ValueError): validate({**VERSION, 'credentials': 'invalid-fixture'})

    def test_revision_transitions(self):
        self.assertFalse(require_successor(VERSION, VERSION))
        self.assertTrue(require_successor(VERSION, {**VERSION, 'cloudRevision': 2}))
        self.assertTrue(require_successor(VERSION, {**VERSION, 'upstreamVersion': '0.1.109'}))
        for replacement in [{'cloudRevision': 3}, {'upstreamVersion': '0.1.107'}, {'upstreamCommit': 'b'*40},
                            {'upstreamVersion': '0.1.109', 'cloudRevision': 2}]:
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                require_successor(VERSION, {**VERSION, **replacement})

    def test_same_release_cannot_point_to_new_digest(self):
        existing = {'version': VERSION, 'image': {'digest': 'sha256:' + 'a'*64}}
        require_same_release(existing, VERSION, 'sha256:' + 'a'*64)
        with self.assertRaises(ValueError): require_same_release(existing, VERSION, 'sha256:' + 'b'*64)


class PlanTest(unittest.TestCase):
    """Real Git: a local upstream stand-in and this branch as the delivery repository."""

    def setUp(self):
        # Fixture releases are built as-is; a committed recipe patch names the real release
        # (test_recipe_patch.py covers patched plans).
        self.enterContext(patch('recipe_patch.load', return_value=None))

    def checkout(self, temporary, **fixture):
        origin, tagged, later = upstream_fixture.upstream(temporary, **fixture)
        value = {**VERSION, 'upstreamVersion': '0.1.150', 'upstreamCommit': tagged}
        directory = Path(temporary) / 'upstream'
        upstream_checkout.fetch(directory, value, url=origin.as_uri())
        return directory, value, tagged, later

    def test_binds_the_upstream_release_and_names_the_delivery(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory, value, tagged, _ = self.checkout(temporary)
            with patch('plan.load', return_value=value):
                result = plan(directory)
            delivery = delivery_git('rev-parse', 'HEAD')
            self.assertEqual(result['sourceCommit'], tagged)
            self.assertEqual(result['upstreamTag'], 'v0.1.150')
            self.assertEqual(result['deliveryCommit'], delivery)
            self.assertEqual(result['sourceTag'], source_tag(delivery))
            self.assertEqual(result['imageTag'], '0.1.150-cloud.1-cn-amd64')
            self.assertEqual(result['electronVersion'], '42.11.12')
            self.assertEqual((result['channel'], result['releaseApproved']), ('candidate', False))

    def test_rejects_a_moved_tag_a_moved_checkout_and_releases_without_the_recipe(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory, value, tagged, later = self.checkout(temporary)
            with patch('plan.load', return_value={**value, 'upstreamCommit': later}):
                with self.assertRaisesRegex(ValueError, 'UPSTREAM_TAG_COMMIT_MISMATCH'): plan(directory)
            upstream_fixture.git(directory, 'fetch', '-q', 'origin', 'main')
            upstream_fixture.git(directory, 'checkout', '-q', '--detach', 'FETCH_HEAD')
            with patch('plan.load', return_value=value):
                with self.assertRaisesRegex(ValueError, 'UPSTREAM_CHECKOUT_MISMATCH'): plan(directory)
        with tempfile.TemporaryDirectory() as temporary:
            directory, value, _, _ = self.checkout(temporary, recipe=False)
            with patch('plan.load', return_value=value):
                with self.assertRaisesRegex(ValueError, 'NO_CLOUD_RECIPE'): plan(directory)

    def test_electron_must_be_an_exact_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory, value, _, _ = self.checkout(temporary, electron='^42.11.12')
            with patch('plan.load', return_value=value):
                with self.assertRaisesRegex(ValueError, 'ELECTRON_VERSION_UNPINNED'): plan(directory)

    def test_missing_previous_object_is_not_treated_as_first_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory, value, _, _ = self.checkout(temporary)
            with patch('plan.load', return_value=value):
                with self.assertRaises(subprocess.CalledProcessError): plan(directory, 'f'*40)
                with self.assertRaisesRegex(ValueError, 'PREVIOUS_MUST_BE_COMMIT_SHA'): plan(directory, 'main')

class PublishTest(unittest.TestCase):
    def test_vpc_transport_preserves_public_identity_and_checks_both_endpoints(self):
        # Integration boundary: transport may change, but every immutable tag
        # must be preflighted and publicly read back as the tested image.
        repo = 'fixture.cn-shanghai.cr.aliyuncs.com/public/runtime'
        private = 'fixture-vpc.cn-shanghai.cr.aliyuncs.com/public/runtime'
        refs = [repo + ':version', repo + ':sha']
        image_id = 'sha256:' + 'a'*64
        state, writes = {}, []
        def inspect(ref):
            return state.get(ref.replace(private, repo))
        def execute(*args):
            writes.append(args)
            if args[1] == 'push':
                state[args[2].replace(private, repo)] = {'config': {'digest': image_id}}
        publish_tags(refs, image_id, inspect=inspect, execute=execute, push_repository=private)
        self.assertEqual([w[2] for w in writes if w[1] == 'push'],
                         [private + ':version', private + ':sha'])
        self.assertEqual(set(state), set(refs))
        writes.clear()
        publish_tags(refs, image_id, inspect=inspect, execute=execute, push_repository=private)
        self.assertEqual(writes, [])
        for wrong in [private.replace('fixture-', 'other-'), private + '-other',
                      private.replace('cn-shanghai', 'cn-beijing'), 'evil.example/public/runtime']:
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, 'PUSH_REPOSITORY'):
                publish_tags(refs, image_id, inspect=inspect, execute=execute, push_repository=wrong)
        conflict = {private + ':sha': {'config': {'digest': 'sha256:' + 'b'*64}}}
        with self.assertRaisesRegex(ValueError, 'CONFLICT'):
            publish_tags(refs, image_id, inspect=conflict.get, execute=execute, push_repository=private)
        self.assertEqual(writes, [])
        # A private push alone must never count as successful public delivery.
        with self.assertRaisesRegex(ValueError, 'PUBLISHED_CONFIG_MISMATCH'):
            publish_tags(refs, image_id, inspect=lambda _: None, execute=lambda *a: None,
                         push_repository=private)

    def test_parallel_preflight_finishes_before_any_publish(self):
        # Unit boundary: concurrent public/VPC reads must not publish early.
        # Existing sequential fixtures cannot expose a late conflict/error.
        # Four reads rendezvous without sleeps; even the last failure blocks writes.
        repo = 'fixture.cn-shanghai.cr.aliyuncs.com/public/runtime'
        private = 'fixture-vpc.cn-shanghai.cr.aliyuncs.com/public/runtime'
        refs = [repo + ':version', repo + ':sha']
        image_id = 'sha256:' + 'a'*64
        for failure in [None, 'conflict', 'transport']:
            with self.subTest(failure=failure):
                barrier = threading.Barrier(4, timeout=2)
                lock = threading.Lock()
                complete, state, writes = set(), {}, []
                def inspect(ref):
                    with lock:
                        preflight = len(complete) < 4
                    if preflight:
                        barrier.wait()
                        with lock:
                            complete.add(ref)
                        if ref == private + ':sha':
                            if failure == 'transport':
                                raise ValueError('REGISTRY_INSPECTION_FAILED')
                            if failure == 'conflict':
                                return {'config': {'digest': 'sha256:' + 'b'*64}}
                    return state.get(ref.replace(private, repo))
                def execute(*args):
                    self.assertEqual(len(complete), 4)
                    writes.append(args)
                    if args[1] == 'push':
                        state[args[2].replace(private, repo)] = {'config': {'digest': image_id}}
                if failure:
                    with self.assertRaisesRegex(ValueError, 'CONFLICT|INSPECTION_FAILED'):
                        publish_tags(refs, image_id, inspect=inspect, execute=execute, push_repository=private)
                    self.assertEqual(writes, [])
                else:
                    publish_tags(refs, image_id, inspect=inspect, execute=execute, push_repository=private)
                    self.assertEqual(set(state), set(refs))

    def test_digest_upload_cannot_tag_unverified_bytes_or_bypass_conflict(self):
        # Unit publish boundary: changing the upload transport must preserve the
        # tested config and both immutable tags. The old docker-push fixtures do
        # not cover an uploaded digest with different bytes or another repository.
        repo = 'registry.example.com/cindy'
        refs = [repo + ':version', repo + ':sha']
        source = repo + '@sha256:' + 'b'*64
        image_id = 'sha256:' + 'a'*64
        for failure in [None, 'conflict', 'config', 'reference', 'transport']:
            with self.subTest(failure=failure):
                state, writes, uploads = {}, [], []
                if failure == 'conflict':
                    state[refs[1]] = {'config': {'digest': 'sha256:' + 'c'*64}}
                def upload():
                    uploads.append(True)
                    if failure == 'transport':
                        raise ValueError('EXPORT_FAILED')
                    state[source] = {'config': {'digest': 'sha256:' + 'c'*64 if failure == 'config' else image_id}}
                    return source.replace('registry.example.com', 'other.example.com') if failure == 'reference' else source
                def execute(*args):
                    writes.append(args)
                    self.assertEqual(args[:5], ('docker', 'buildx', 'imagetools', 'create', '--prefer-index=false'))
                    self.assertEqual(args[-1], source)
                    state[args[-2]] = state[source]
                if failure:
                    with self.assertRaisesRegex(ValueError, 'CONFLICT|MISMATCH|EXPORT_FAILED'):
                        publish_tags(refs, image_id, inspect=state.get, execute=execute, export_tested=upload)
                    self.assertEqual(writes, [])
                    if failure == 'conflict': self.assertEqual(uploads, [])
                else:
                    publish_tags(refs, image_id, inspect=state.get, execute=execute, export_tested=upload)
                    self.assertEqual(len(uploads), 1)
                    self.assertEqual([state[r] for r in refs], [state[source], state[source]])
                    writes.clear(); uploads.clear()
                    publish_tags(refs, image_id, inspect=state.get, execute=execute, export_tested=upload)
                    self.assertEqual((writes, uploads), ([], []))
                    # A partial pair must keep its original manifest even if a
                    # later exporter could encode the same config differently.
                    del state[refs[1]]
                    publish_tags(refs, image_id, inspect=state.get, execute=execute,
                                 export_tested=upload, existing_source=lambda ref, _: source)
                    self.assertEqual(uploads, [])
                    self.assertEqual(len(writes), 1)
                    self.assertEqual(state[refs[0]], state[refs[1]])

    def test_existing_identical_image_is_not_pushed_twice(self):
        executed = []
        record = {'config': {'digest': 'sha256:'+'a'*64}}
        publish('registry.example.com/cindy:tag', record['config']['digest'],
                inspect=lambda _: record, execute=lambda *a: executed.append(a))
        self.assertEqual(executed, [])

    def test_conflict_and_read_failure_have_no_external_writes(self):
        executed = []
        with self.assertRaisesRegex(ValueError, 'CONFLICT'):
            publish('registry.example.com/cindy:tag', 'sha256:'+'b'*64,
                    inspect=lambda _: {'config': {'digest': 'sha256:'+'a'*64}}, execute=lambda *a: executed.append(a))
        for text in ['unauthorized', 'network timeout', 'name not found']:
            with patch('publish.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', text)):
                with self.assertRaisesRegex(ValueError, 'INSPECTION_FAILED'): registry_manifest('example:tag')
        self.assertEqual(executed, [])
        with patch('publish.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', 'ERROR: example:tag: not found')):
            self.assertIsNone(registry_manifest('example:tag'))

    def test_publish_uses_tested_config_and_rejects_changed_bytes(self):
        calls = []
        replies = iter([None, {'config': {'digest': 'sha256:'+'a'*64}}])
        publish('registry.example.com/cindy:tag', 'sha256:'+'a'*64,
                inspect=lambda _: next(replies), execute=lambda *a: calls.append(a))
        self.assertEqual(calls[0], ('docker', 'tag', 'sha256:'+'a'*64, 'registry.example.com/cindy:tag'))
        self.assertEqual(calls[1][0:2], ('docker', 'push'))
        replies = iter([None, {'config': {'digest': 'sha256:'+'b'*64}}])
        with self.assertRaisesRegex(ValueError, 'PUBLISHED_CONFIG_MISMATCH'):
            publish('registry.example.com/cindy:tag', 'sha256:'+'a'*64,
                    inspect=lambda _: next(replies), execute=lambda *a: None)

    def test_two_tags_preflight_conflicts_and_recover_partial_publish(self):
        # Integration-boundary regression: a conflicting second alias must not
        # publish the first; a retry after one successful push fills only the gap.
        refs = ['registry.example.com/cindy:version', 'registry.example.com/cindy:sha']
        image_id = 'sha256:' + 'a'*64
        state = {refs[1]: {'config': {'digest': 'sha256:' + 'b'*64}}}
        writes = []
        def execute(*args):
            writes.append(args)
            if args[1] == 'push': state[args[2]] = {'config': {'digest': image_id}}
        with self.assertRaisesRegex(ValueError, 'CONFLICT'):
            publish_tags(refs, image_id, inspect=state.get, execute=execute)
        self.assertEqual(writes, [])
        state = {refs[0]: {'config': {'digest': image_id}}}
        publish_tags(refs, image_id, inspect=state.get, execute=execute)
        self.assertEqual([w[2] for w in writes if w[1] == 'push'], [refs[1]])
        self.assertEqual(state[refs[0]], state[refs[1]])

    def test_prepublication_gate_rejects_wrong_source_and_incomplete_smoke(self):
        with tempfile.TemporaryDirectory() as temporary:
            records = Path(temporary)
            p = {'version': VERSION, 'imageTag': image_tag(VERSION), 'channel': 'candidate', 'releaseApproved': False,
                 'sourceCommit': 'a'*40, 'electronVersion': '42.11.12'}
            image_id = 'sha256:'+'c'*64
            info = {'Id': image_id, 'Os': 'linux', 'Architecture': 'amd64', 'RootFS': {'Layers': ['a','b']}, 'Config': {'Labels': {
                'io.cindy.source-commit': 'a'*40, 'io.cindy.upstream-version': VERSION['upstreamVersion'],
                'io.cindy.cloud-revision': str(VERSION['cloudRevision']), 'io.cindy.region': 'cn', 'io.cindy.target-architecture': 'amd64'}}}
            result = {'imageId': image_id, 'sourceCommit': 'a'*40}
            proof = {'imageId': image_id, 'passed': True, 'nativeArchitecture': 'x86_64', 'applicationVersion': '0.1.108-cloud.1', **{k:True for k in ['dockPreferencesHidden','networkIsolated','readOnlyRoot','sandboxedRenderers','legacyHome','desktopReady','shutdown']}}
            for n in ['runtime-layer-audit.json','agent-source-proof.json','overlay-application.json']:
                (records/n).write_text('{}')
            identity = {'upstreamVersion': VERSION['upstreamVersion'], 'cloudRevision': VERSION['cloudRevision']}
            (records/'build-inputs.json').write_text(json.dumps({'sourceCommit':'a'*40,'baseRecipeCommit':'b'*40,'version':identity}))
            native = records/'native-modules.json'
            native.write_text(json.dumps({'passed':True,'sqlite':True,'sqliteVec':True,'pty':True,'electronVersion':'42.11.12','abi':'145'}))
            self.assertEqual(len(check_build(p,info,result,proof,records)),5)
            # A sqlite/pty-only proof misses an LFS pointer in vec0.so.
            complete = json.loads(native.read_text())
            for vec_proof in (None, False):
                legacy = {k:v for k,v in complete.items() if k != 'sqliteVec'}
                if vec_proof is not None: legacy['sqliteVec'] = vec_proof
                native.write_text(json.dumps(legacy))
                with self.assertRaisesRegex(ValueError, 'NATIVE_PROBE_MISSING'): check_build(p,info,result,proof,records)
            native.write_text(json.dumps({'passed':True,'sqlite':True,'sqliteVec':True,'pty':False,'electronVersion':'42.11.12','abi':'145'}))
            with self.assertRaisesRegex(ValueError, 'NATIVE_PROBE_MISSING'): check_build(p,info,result,proof,records)
            native.write_text(json.dumps({'passed':True,'sqlite':True,'sqliteVec':True,'pty':True,'electronVersion':'42.11.12','abi':'145'}))
            for key,value in [('imageId','sha256:'+'b'*64),('dockPreferencesHidden',False),('networkIsolated',False),('nativeArchitecture','arm64'),('shutdown',False),('applicationVersion','0.1.108')]:
                with self.subTest(key=key), self.assertRaises(ValueError): check_build(p,info,result,{**proof,key:value},records)
            broken = copy.deepcopy(info);broken['Config']['Labels']['io.cindy.cloud-revision']='99'
            with self.assertRaisesRegex(ValueError, 'LABEL'): check_build(p,broken,result,proof,records)
            # Another source commit anywhere in the records is another build.
            with self.assertRaisesRegex(ValueError, 'BUILD_IDENTITY_MISMATCH'): check_build(p,info,{**result,'sourceCommit':'d'*40},proof,records)
            broken = copy.deepcopy(info);broken['Config']['Labels']['io.cindy.source-commit']='d'*40
            with self.assertRaisesRegex(ValueError, 'LABEL'): check_build(p,broken,result,proof,records)
            # The packaged modules must load in the Electron the release pins.
            with self.assertRaisesRegex(ValueError, 'NATIVE_PROBE_MISSING'): check_build({**p,'electronVersion':'43.0.0'},info,result,proof,records)
            for inputs in ({'sourceCommit':'d'*40,'version':identity}, {'sourceCommit':'a'*40,'version':VERSION}):
                (records/'build-inputs.json').write_text(json.dumps(inputs))
                with self.subTest(inputs=inputs), self.assertRaisesRegex(ValueError, 'BUILD_RECORD_IDENTITY_MISMATCH'):
                    check_build(p,info,result,proof,records)

if __name__ == '__main__': unittest.main()
