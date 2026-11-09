import '@fontsource-variable/inter';
import 'harmonyos-sans-sc-webfont-splitted';
import '@/i18n';
import '../themes/colors';
import '../styles/globals.css';
import '../features/remote-desktop/viewerWindow.css';

import { createRoot } from 'react-dom/client';
import { getInitialThemeVariant, ThemeProvider } from '@/hooks/useTheme';
import { applyFontSettings, getInitialFontSettings, FontSettingsProvider } from '@/hooks/useFontSettings';
import { themeService } from '../themes/theme-service';
import { RemoteDesktopViewerWindow } from '../features/remote-desktop/RemoteDesktopViewerWindow';
import { TopLevelErrorBoundary } from '../components/error/TopLevelErrorBoundary';

/** The native viewer window's surface, as a browser tab bound to one owned instance. */
export function mountDesktopPage(deviceId: string) {
  document.documentElement.dataset.platform = 'web';
  themeService.applyTheme(getInitialThemeVariant().theme);
  applyFontSettings(getInitialFontSettings());
  if (!/^cloud-device-[a-f0-9]{24}$/u.test(deviceId)) {
    location.replace(location.pathname);
    return;
  }
  createRoot(document.getElementById('root')!).render(
    <TopLevelErrorBoundary>
      <ThemeProvider syncWindowVibrancy={false}>
        <FontSettingsProvider>
          <RemoteDesktopViewerWindow />
        </FontSettingsProvider>
      </ThemeProvider>
    </TopLevelErrorBoundary>,
  );
}
