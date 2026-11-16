/** Development-only interactive trial. Never connected to a real owner or disk. */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudSettingsPanel } from './CloudSettingsView';
import { createTrialCloudSettingsClient } from './trialClient';

// The client lives on its own, so the dev options' frames can use it without this page.
export { createTrialCloudSettingsClient };
export function CloudSettingsTrial() {
  const { t } = useTranslation();
  const client = useMemo(createTrialCloudSettingsClient, []);
  if (!import.meta.env.DEV) return null;
  return (
    <div className="h-full">
      <CloudSettingsPanel
        name={t('cloudSettings.trialInstance')}
        client={client}
        online
        trial
        onBack={() => {
          window.location.hash = '/cc-agent';
        }}
      />
    </div>
  );
}
