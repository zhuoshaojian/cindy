import { Settings2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_RAIL_ICON_BUTTON_CLASS } from '@/components/sidebar/SidebarIconButton';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** A direct action on the named device, never a second instance picker. */
export function CloudSettingsShortcut({ deviceId, name }: { deviceId: string; name: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const label = t('cloudSettings.openFor', { name });
  return (
    <div className={cn(
      'shrink-0 pointer-events-none opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
      'group-hover/device-header:pointer-events-auto group-hover/device-header:opacity-100',
      'has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100',
    )}>
      <Tip text={label} side="right">
        <Link
          to={`/cloud-settings?${new URLSearchParams({ deviceId })}`}
          state={{ returnTo: location.pathname + location.search }}
          aria-label={label}
          className={cn(
            SIDEBAR_RAIL_ICON_BUTTON_CLASS,
            'h-6 w-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Settings2 size={14} aria-hidden />
        </Link>
      </Tip>
    </div>
  );
}
