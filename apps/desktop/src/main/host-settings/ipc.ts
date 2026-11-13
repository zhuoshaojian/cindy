import { readModelSettings, validateModelSettingsChange, commitModelSettings } from './additionalModels.js';
import { applyAdditionalSettings } from './additionalApplication.js';
import { configureAdditionalNativeOperations } from './additionalRuntime.js';
import { nativeSettingsOperations } from './additionalNative.js';
import { ipcMain } from 'electron';
import { configureHostSettingsApplication } from './index.js';
import { isManagedCloudInstance } from './personalization.js';
import { registerHostAppSettingsSections } from './appSettingsSections.js';

let registered = false;
/**
 * Wires the Host settings service. The app window keeps its own settings as upstream does; it
 * only asks once whether it runs on a managed cloud instance.
 */
export function registerHostSettingsIpc(databaseWarningChanged: () => void): void {
  if (registered) return;
  registered = true;
  configureAdditionalNativeOperations(nativeSettingsOperations);
  configureHostSettingsApplication({ models: { read: readModelSettings, validate: validateModelSettingsChange, commit: commitModelSettings }, additional: applyAdditionalSettings, databaseWarning: databaseWarningChanged });
  ipcMain.on('host-settings:host-owned', event => { event.returnValue = isManagedCloudInstance(); });
  // Ordinary desktops register only upstream's own settings sections.
  if (isManagedCloudInstance()) registerHostAppSettingsSections();
}
