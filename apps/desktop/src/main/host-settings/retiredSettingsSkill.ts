import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { cindyManagedHomeDir, isCloudPilotDistribution } from '../cloudPilotDistribution.js';
import { getInstanceConfig } from '../instance-runtime/config.js';
import { createLogger } from '../logger.js';

const log = createLogger('host-settings-skill');

/**
 * Earlier cloud builds projected a `cindy-settings` Skill; Agents now use the upstream settings
 * tools. Only builds that could have installed it (cloud instances and the Dev package) clean up,
 * and only links that still point at the profile copy are removed.
 */
export function removeRetiredSettingsSkill(): void {
  if (!getInstanceConfig() && !isCloudPilotDistribution()) return;
  try {
    const root = path.join(app.getPath('userData'), 'host-settings-skills');
    const rootStat = fs.lstatSync(root, { throwIfNoEntry: false });
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return;
    const source = path.join(root, 'cindy-settings');
    const home = cindyManagedHomeDir();
    const claudeConfigDir = isCloudPilotDistribution() ? path.join(home, '.claude') : process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    for (const entry of new Set([path.join(home, '.agents', 'skills', 'cindy-settings'), path.join(claudeConfigDir, 'skills', 'cindy-settings')])) {
      const stat = fs.lstatSync(entry, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink() && path.resolve(path.dirname(entry), fs.readlinkSync(entry)) === source) fs.unlinkSync(entry);
    }
    fs.rmSync(root, { recursive: true, force: true });
  } catch (error) {
    log.warn('retired settings Skill cleanup skipped', { error: error instanceof Error ? error.message : String(error) });
  }
}
