"""The session runs apply-agent-skills.py from the image on every start, against the
persistent home. These tests run the same file from a temporary image folder."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
WRITER = HERE / 'apply-agent-skills.py'
V1 = b'---\nname: demo\ndescription: First version.\n---\nBody one.\n'
V2 = b'---\nname: demo\ndescription: Second version.\n---\nBody two.\n'


class ApplyAgentSkillsTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.image = self.root / 'image'
        (self.image / 'demo').mkdir(parents=True)
        shutil.copyfile(WRITER, self.image / WRITER.name)
        self.home = self.root / 'home'
        self.home.mkdir()
        self.skill = self.home / '.agents/skills/demo'
        self.ship(V1)

    def ship(self, content):
        (self.image / 'demo/SKILL.md').write_bytes(content)

    def start(self):
        subprocess.run([sys.executable, '-I', str(self.image / WRITER.name)], check=True,
                       capture_output=True, env={'HOME': str(self.home), 'PATH': os.environ.get('PATH', '')})

    def history(self):
        state = self.home / '.config/cindy-desktop/agent-skills.json'
        return json.loads(state.read_text())['written'] if state.exists() else None

    def recorded(self):
        return json.loads((self.skill / '.cindy-cloud-skill.json').read_text())['sha256']

    def agents_folder(self):
        agents = self.home / '.agents'
        return {p.relative_to(agents): str(p.readlink()) if p.is_symlink() else
                p.read_bytes() if p.is_file() else None for p in agents.rglob('*')}

    def test_first_start_writes_the_skill_and_remembers_it(self):
        self.start()
        self.assertEqual((self.skill / 'SKILL.md').read_bytes(), V1)
        self.assertEqual(self.recorded(), hashlib.sha256(V1).hexdigest())
        self.assertEqual([p.name for p in self.skill.parent.iterdir()], ['demo'])
        self.assertEqual(self.history(), ['demo'])

    def test_unchanged_copy_follows_the_image_version(self):
        self.start()
        self.ship(V2)
        self.start()
        self.assertEqual((self.skill / 'SKILL.md').read_bytes(), V2)
        self.assertEqual(self.recorded(), hashlib.sha256(V2).hexdigest())
        # The marker in the folder still identifies the copy when the home's list is lost.
        shutil.rmtree(self.home / '.config')
        self.ship(V1)
        self.start()
        self.assertEqual((self.skill / 'SKILL.md').read_bytes(), V1)
        self.assertEqual(self.history(), ['demo'])
        # A refresh interrupted after SKILL.md, before the marker, is finished next start.
        (self.skill / 'SKILL.md').write_bytes(V2)
        self.ship(V2)
        self.start()
        self.assertEqual(self.recorded(), hashlib.sha256(V2).hexdigest())

    def test_same_name_skill_that_is_not_ours_is_never_touched(self):
        elsewhere = self.root / 'elsewhere'
        elsewhere.mkdir()
        (elsewhere / 'SKILL.md').write_bytes(b'theirs\n')
        for kind in ['folder', 'link', 'file', 'edited copy']:
            with self.subTest(kind=kind):
                shutil.rmtree(self.home)
                self.skill.parent.mkdir(parents=True)
                self.ship(V1)
                if kind == 'folder':
                    self.skill.mkdir()
                    (self.skill / 'SKILL.md').write_bytes(b'theirs\n')
                elif kind == 'link':
                    self.skill.symlink_to(elsewhere)
                elif kind == 'file':
                    self.skill.write_bytes(b'theirs\n')
                else:
                    self.start()
                    (self.skill / 'SKILL.md').write_bytes(b'edited by the user\n')
                    self.ship(V2)
                before = self.agents_folder()
                self.start()
                self.assertEqual(self.agents_folder(), before)
                self.assertEqual((elsewhere / 'SKILL.md').read_bytes(), b'theirs\n')
                self.assertEqual(self.history(), ['demo'] if kind == 'edited copy' else None)

    def test_skill_the_user_deleted_is_not_written_again(self):
        self.start()
        shutil.rmtree(self.skill)
        self.ship(V2)
        self.start()
        self.assertFalse(os.path.lexists(self.skill))
        self.assertEqual(self.history(), ['demo'])


class ShippedSkillsTest(unittest.TestCase):
    def test_frontmatter_is_valid_for_every_engine(self):
        # Codex, Claude and Pi skip a Skill whose name does not match its folder or whose
        # frontmatter does not parse; an unquoted ': ' or ' #' breaks the YAML value.
        skills = sorted(HERE.glob('*/SKILL.md'))
        self.assertTrue(skills)
        for path in skills:
            with self.subTest(skill=path.parent.name):
                head = re.fullmatch(r'---\n(.*?)\n---\n.+', path.read_text(), re.S)
                self.assertIsNotNone(head)
                fields = dict(line.split(': ', 1) for line in head.group(1).splitlines())
                self.assertEqual(set(fields), {'name', 'description'})
                self.assertEqual(fields['name'], path.parent.name)
                self.assertRegex(fields['name'], r'^[a-z0-9]+(-[a-z0-9]+)*$')
                self.assertLessEqual(len(fields['name']), 64)
                self.assertTrue(0 < len(fields['description']) <= 1024)
                self.assertNotRegex(fields['description'], r': | #|^[\[\]{}>|*&!%@`\'"]')


if __name__ == '__main__':
    unittest.main()
