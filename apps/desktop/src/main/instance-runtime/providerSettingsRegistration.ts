import { resolveProviderLogoKind, type ProviderLogoRouting } from '@cindy/model-providers/branding';
import * as authManager from '../authManager.js';
import { projectRoutingForDisplay, setCloudPrivateInvokeHandler } from '../device-link/dispatch.js';
import { callCloudManagement } from '../host-settings/managementCalls.js';
import {
  inspectModelPresentationPreferences,
  mutateModelPresentationPreferences,
} from '../host-settings/model-presentation-preferences.js';
import { currentSettingsOwner } from '../host-settings/personalization.js';
import { getInstanceConfig } from './config.js';
import { createProviderSettingsChannel } from './providerSettingsChannel.js';

/** Managed cloud instances only: the owner's cloud settings page manages providers over DeviceLink. */
export function registerCloudProviderSettings(): () => void {
  const instance = getInstanceConfig();
  if (!instance) return () => {};
  setCloudPrivateInvokeHandler(
    createProviderSettingsChannel({
      isInstanceOwner: () =>
        getInstanceConfig()?.membershipId === instance.membershipId &&
        authManager.getCurrentUserId() === instance.membershipId,
      owner: currentSettingsOwner,
      call: callCloudManagement,
      inspectVisibility: inspectModelPresentationPreferences,
      mutateVisibility: mutateModelPresentationPreferences,
      projectRouting: projectRoutingForDisplay,
      resolveLogoKind: (providerId, routing) =>
        resolveProviderLogoKind(providerId, routing as ProviderLogoRouting | undefined),
    }),
  );
  return () => setCloudPrivateInvokeHandler(null);
}
