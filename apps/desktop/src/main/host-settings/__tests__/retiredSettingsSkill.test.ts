import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const context = vi.hoisted(() => ({ root: '', instance: false, pilot: false }));
vi.mock('electron', () => ({ app: { getPath: () => path.join(context.root, 'user-data') } }));
vi.mock('../../instance-runtime/config.js', () => ({ getInstanceConfig: () => (context.instance ? {} : null) }));
vi.mock('../../cloudPilotDistribution.js', () => ({
  cindyManagedHomeDir: () => path.join(context.root, 'home'),
  isCloudPilotDistribution: () => context.pilot,
}));
vi.mock('../../logger.js', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));
import { removeRetiredSettingsSkill } from '../retiredSettingsSkill.js';

const savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
const copy = () => path.join(context.root, 'user-data', 'host-settings-skills', 'cindy-settings');
const agentsLink = () => path.join(context.root, 'home', '.agents', 'skills', 'cindy-settings');
const claudeLink = () => path.join(context.root, 'home', '.claude', 'skills', 'cindy-settings');
const exists = (file: string) => fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;

beforeEach(() => {
  context.root = fs.mkdtempSync(path.join(os.tmpdir(), 'retired-settings-skill-'));
  context.instance = false;
  context.pilot = false;
  delete process.env.CLAUDE_CONFIG_DIR;
  fs.mkdirSync(copy(), { recursive: true });
  fs.writeFileSync(path.join(copy(), 'SKILL.md'), 'old');
  for (const link of [agentsLink(), claudeLink()]) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(copy(), link);
  }
});
afterEach(() => {
  fs.rmSync(context.root, { recursive: true, force: true });
  if (savedClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir;
});

it('leaves an ordinary desktop untouched', () => {
  removeRetiredSettingsSkill();
  expect(exists(copy()) && exists(agentsLink()) && exists(claudeLink())).toBe(true);
});

it.each([['a cloud instance', true, false], ['the Dev package', false, true]])(
  'removes the projected Skill and its links on %s',
  (_name, instance, pilot) => {
    context.instance = instance;
    context.pilot = pilot;
    removeRetiredSettingsSkill();
    expect([exists(copy()), exists(agentsLink()), exists(claudeLink())]).toEqual([false, false, false]);
  },
);

it('keeps a Skill of the same name the user owns and links that point elsewhere', () => {
  context.instance = true;
  fs.unlinkSync(agentsLink());
  fs.mkdirSync(agentsLink());
  fs.writeFileSync(path.join(agentsLink(), 'SKILL.md'), 'mine');
  const other = path.join(context.root, 'elsewhere');
  fs.mkdirSync(other);
  fs.unlinkSync(claudeLink());
  fs.symlinkSync(other, claudeLink());
  removeRetiredSettingsSkill();
  expect(fs.readFileSync(path.join(agentsLink(), 'SKILL.md'), 'utf8')).toBe('mine');
  expect(fs.readlinkSync(claudeLink())).toBe(other);
  expect(exists(copy())).toBe(false);
});
