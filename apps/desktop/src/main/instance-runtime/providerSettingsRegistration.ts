import { storedCustomProviderId } from '@cindy/model-providers';
import { resolveProviderLogoKind, type ProviderLogoRouting } from '@cindy/model-providers/branding';
import { applyCustomModelEdit } from '../../shared/customModelEdit.js';
import * as authManager from '../authManager.js';
import { projectRoutingForDisplay, setCloudPrivateInvokeHandler } from '../device-link/dispatch.js';
import { callCloudManagement } from '../host-settings/managementCalls.js';
import {
  inspectModelPresentationPreferences,
  mutateModelPresentationPreferences,
} from '../host-settings/model-presentation-preferences.js';
import {
  applyHostModelEffort,
  readNewTaskPreferenceHistory,
} from '../host-settings/new-task-defaults.js';
import { currentSettingsOwner } from '../host-settings/personalization.js';
import { getCustomProvider } from '../maker-host/custom-provider-store.js';
import { executeProviderShareGuestCommand } from '../device-link/providerShareRuntime.js';
import { cloudModelAccessControl } from '../model-access/index.js';
import { providerSecretStorageKey } from '../../shared/providerSecrets.js';
import { getInstanceConfig } from './config.js';
import { createProviderSettingsChannel } from './providerSettingsChannel.js';
import { createProviderSetup, setProviderSetup } from './providerSetup.js';

/** Managed cloud instances only: the owner's cloud settings page manages providers over DeviceLink. */
export function registerCloudProviderSettings(): () => void {
  const instance = getInstanceConfig();
  if (!instance) return () => {};
  const isInstanceOwner = () =>
    getInstanceConfig()?.membershipId === instance.membershipId &&
    authManager.getCurrentUserId() === instance.membershipId;
  const setup = createProviderSetup(callCloudManagement);
  setProviderSetup({
    setup,
    owner: () => {
      const owner = isInstanceOwner() ? currentSettingsOwner() : null;
      return owner ? `${owner.dataOwnerId}:${owner.ownerGeneration}` : null;
    },
  });
  setCloudPrivateInvokeHandler(
    createProviderSettingsChannel({
      isInstanceOwner,
      owner: currentSettingsOwner,
      call: callCloudManagement,
      inspectVisibility: inspectModelPresentationPreferences,
      mutateVisibility: mutateModelPresentationPreferences,
      projectRouting: projectRoutingForDisplay,
      resolveLogoKind: (providerId, routing) =>
        resolveProviderLogoKind(providerId, routing as ProviderLogoRouting | undefined),
      readEfforts: () =>
        Object.fromEntries(
          Object.entries(readNewTaskPreferenceHistory()?.providerModelMemory ?? {}).map(
            ([slot, memory]) => [slot, { ...memory.effortByModel }],
          ),
        ),
      applyEffort: (pref) => applyHostModelEffort(pref),
      shareCommand: (command) => executeProviderShareGuestCommand(command),
      setup,
      modelAccess: cloudModelAccessControl,
      xdKey: providerSecretStorageKey('xd'),
      async editModel({ providerId, agent, modelId, edit }, execution) {
        const config = await getCustomProvider(storedCustomProviderId(providerId));
        execution.assertCurrent();
        if (!config) throw new Error('[NOT_FOUND] custom provider is gone');
        if (!applyCustomModelEdit(config, agent, modelId, edit))
          throw new Error('[INVALID_PARAMS] model edit does not apply');
        const result = (await callCloudManagement(
          'maker:provider:custom:update',
          [config, {}, { source: 'manual-settings' }],
          execution,
        )) as { ok?: unknown; confirmationRequired?: unknown } | null;
        if (result?.ok !== true)
          throw new Error(
            result?.confirmationRequired
              ? '[PRECONDITION_FAILED] the change waits for running tasks; retry later'
              : '[INTERNAL] the provider was not updated',
          );
      },
    }),
  );
  return () => {
    setCloudPrivateInvokeHandler(null);
    setProviderSetup(null);
  };
}
