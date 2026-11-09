import { installWebElectronApi } from './electronApi';

/**
 * Browser entry for the cloud instance pages CIS serves to a signed-in owner. The bridge
 * must exist before any shared module reads it, so the pages load only after it.
 */
const parts = installWebElectronApi();
const signIn = () => location.replace('/instance-login/');

async function start() {
  const { readCisSession, CisSessionEndedError } = await import('./session');
  let session: Awaited<ReturnType<typeof readCisSession>>;
  try {
    session = await readCisSession();
  } catch (error) {
    if (error instanceof CisSessionEndedError) signIn();
    // A network failure is not a sign-out; reloading tries again.
    else document.getElementById('root')!.textContent = navigator.language.startsWith('zh') ? '无法连接云服务，请刷新重试。' : 'Cannot reach the cloud service. Reload to try again.';
    return;
  }
  const { createWebCloudApi } = await import('./webApi');
  const api = createWebCloudApi(session, signIn);
  parts.cloudSettings = api.cloudSettings;
  parts.deviceLink = api.deviceLink;
  // Pages that point to the instance's own settings open its remote desktop the same way.
  const { openDesktopTab } = await import('./desktopTab');
  parts.openRemoteDesktop = async ({ deviceId, name }: { deviceId: string; name: string }) => openDesktopTab(deviceId, name);
  const desktop = /^#\/desktop(?:\?|$)/u.test(location.hash);
  if (desktop) {
    const params = new URLSearchParams(location.hash.slice(location.hash.indexOf('?') + 1));
    const { createWebRemoteDesktopViewer } = await import('./remoteDesktopViewer');
    const deviceId = params.get('deviceId') ?? '';
    parts.remoteDesktopViewer = createWebRemoteDesktopViewer(api.relay, { deviceId, name: params.get('name') ?? '' });
    (await import('./desktopPage')).mountDesktopPage(deviceId);
  } else (await import('./app')).mountCloudApp(api, session);
}
void start();
