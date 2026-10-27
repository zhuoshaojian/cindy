import { mountPage, forbid } from '../../ui-page/harness';
import { LoginBrandStage } from '../../../src/renderer/components/login/LoginBrandStage';
import { CloudInstanceLoginPage } from '../../../src/renderer/features/cloud-settings/CloudInstanceLoginPage';
import { CloudInstanceAccessProvider } from '../../../src/renderer/features/cloud-settings/CloudInstanceAccess';
import { setDataOwnerGeneration } from '../../../src/renderer/contexts/dataOwnerGeneration';
import type { CloudInstanceLoginView } from '../../../src/shared/cloudInstanceLogin';

const deviceId = 'cloud-device-aaaaaaaaaaaaaaaaaaaaaaaa';
mountPage({
  route: `/cloud-login?deviceId=${deviceId}`,
  host: (ctx) => {
    const states: Record<string, CloudInstanceLoginView['state']> = {
      default: {
        step: 'identifier',
        providers: {
          region: 'cn',
          attribution: 'phone',
          phone: true,
          email: false,
          social: ['wechat', 'apple'],
        },
      },
      code: { step: 'verification-code', kind: 'phone', identifier: '+15555550123' },
      binding: { step: 'binding', bindType: 'phone', codeRequested: false },
      verification: {
        step: 'sso-verification',
        channel: 'sms',
        targetMasked: '***123',
        codeRequested: false,
      },
    };
    const view: CloudInstanceLoginView = {
      handle: '11111111-1111-4111-8111-111111111111',
      state: states[ctx.case] ?? states.default!,
      complete: false,
    };
    return {
      platform: 'darwin',
      cloudSettings: {
        instanceAccess: async () => ({ schemaVersion: 1, allowed: true }),
        instanceList: async () => [
          { deviceId, loginRequired: true, name: '云端 Cindy', nameSequence: 1 },
        ],
        instanceLoginStart: async () => view,
        instanceLoginPoll: async () => view,
        instanceLoginClose: async () => undefined,
        instanceLoginDispatch: forbid('real cloud login'),
      },
      authDispatch: forbid('local account mutation'),
      authInitialize: forbid('local account initialization'),
      acceptPrivacyConsent: async () => undefined,
    };
  },
  render: () => {
    setDataOwnerGeneration('fixture-owner', 1);
    return (
      <CloudInstanceAccessProvider>
        <LoginBrandStage />
        <CloudInstanceLoginPage />
      </CloudInstanceAccessProvider>
    );
  },
});
