"""Write this image's agent Skills into ~/.agents/skills before Cindy starts.

Each folder next to this file holds one SKILL.md. Its copy in the home is written when it
is missing and was never written there, and refreshed while it still holds a version this
image wrote. A same-name Skill of the user's, an edited copy and a deleted copy are left
as they are. See README.md.
"""
import hashlib
import json
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
MARKER = '.cindy-cloud-skill.json'
ORIGIN = 'cindy-cloud-image'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_regular(path):
    """Contents of a regular file that is not a link; None for anything else."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return None
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            return None
        return stream.read()


def read_json(path):
    data = read_regular(path)
    try:
        return None if data is None else json.loads(data)
    except ValueError:
        return None


def write_file(path, data):
    """Replace path atomically with a file only its owner can read."""
    fd, temp = tempfile.mkstemp(prefix='.' + path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.replace(temp, path)
    except BaseException:
        Path(temp).unlink(missing_ok=True)
        raise


def marker(content):
    return (json.dumps({'origin': ORIGIN, 'sha256': digest(content)}) + '\n').encode()


def written_digest(folder):
    """SHA-256 recorded when this image wrote the folder, or None."""
    record = read_json(folder / MARKER)
    if isinstance(record, dict) and record.get('origin') == ORIGIN and isinstance(record.get('sha256'), str):
        return record['sha256']
    return None


def apply(name, content, root, history):
    """Bring one Skill up to date. True when the home holds this image's copy."""
    target = root / name
    if not os.path.lexists(target):
        # Deleted after it was written, or the history is unreadable: keep it absent.
        if history is None or name in history:
            return False
        # Assemble beside the scanned folder so that no partial Skill is ever listed.
        temp = Path(tempfile.mkdtemp(prefix='.cindy-skill-', dir=root.parent))
        try:
            write_file(temp / 'SKILL.md', content)
            write_file(temp / MARKER, marker(content))
            os.rename(temp, target)
        except BaseException:
            shutil.rmtree(temp, ignore_errors=True)
            raise
        return True
    if target.is_symlink() or not target.is_dir():
        return False
    recorded = written_digest(target)
    current = read_regular(target / 'SKILL.md')
    # An interrupted refresh leaves this image's content with the previous digest.
    if recorded is None or current is None or digest(current) not in (recorded, digest(content)):
        return False
    if current != content:
        write_file(target / 'SKILL.md', content)
    if recorded != digest(content):
        write_file(target / MARKER, marker(content))
    return True


def main():
    home = Path.home()
    root = home / '.agents' / 'skills'
    state = home / '.config' / 'cindy-desktop' / 'agent-skills.json'
    record = {'version': 1, 'written': []} if not os.path.lexists(state) else read_json(state)
    names = record.get('written') if isinstance(record, dict) else None
    history = set(names) if isinstance(names, list) and all(isinstance(n, str) for n in names) else None
    if history is None:
        print('AGENT_SKILLS_STATE_UNREADABLE', file=sys.stderr)
    root.mkdir(parents=True, exist_ok=True)
    present = set()
    for source in sorted(SOURCE.glob('*/SKILL.md')):
        name = source.parent.name
        try:
            if apply(name, source.read_bytes(), root, history):
                present.add(name)
        except OSError as error:
            print(f'AGENT_SKILL_SKIPPED:{name}:{type(error).__name__}', file=sys.stderr)
    if history is not None and not present <= history:
        state.parent.mkdir(parents=True, exist_ok=True)
        write_file(state, (json.dumps({'version': 1, 'written': sorted(history | present)}) + '\n').encode())


if __name__ == '__main__':
    main()
