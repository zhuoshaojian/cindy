import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCloudSimulating } from './cloudFaults';
import { CloudFaultBeacon } from './CloudFaultBeacon';
import { openCloudScenarios } from './cloudFaultScripts';

/**
 * Dev options (dev builds only, in Chinese only). The design alternatives once chosen here are
 * decided (owner, 2026-11-12: the card shown by default, its actions in one ⋯ menu) and removed;
 * what is left is the entry to the simulated failures.
 */

function PreviewRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-12 font-medium text-[var(--text-secondary)]">{title}</span>
      {children}
    </div>
  );
}

/**
 * A floating "Dev options" button in the window's bottom-right corner (owner, 2026-11-09: the
 * switches inside the page distorted how it looked). It takes no space in the page, so Remote
 * connections and the cloud settings page lay out exactly as in a release build.
 */
export function CloudPreviewSwitches(props: CloudDevOptionsProps) {
  return import.meta.env.DEV ? <CloudDevOptions {...props} /> : null;
}

type CloudDevOptionsProps = {
  /** For the UI page fixture's screenshot only. */
  defaultOpen?: boolean;
};

/** The floating entry itself, without the dev-build gate (the UI page builds as a release). */
export function CloudDevOptions({ defaultOpen }: CloudDevOptionsProps) {
  const fault = useCloudSimulating();
  const [open, setOpen] = useState(!!defaultOpen);
  return createPortal(
    <div data-cloud-preview className="fixed bottom-4 right-4 z-40">
      {/* The scenario panel, above this button while open (it places itself). */}
      <CloudFaultBeacon raised />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" compact className="shadow-[var(--shadow-menu)]">
            <FlaskConical size={14} aria-hidden />
            开发选项
            {/* A simulated failure must not pass for a real one. */}
            {fault && (
              <span
                title="模拟期间所有修改都不会发到云端 Cindy"
                className="inline-flex items-center gap-1 text-[var(--error-fg)]"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--error-fg)]" />
                模拟中
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          aria-label="开发选项"
          className="flex w-[min(20rem,calc(100vw-32px))] flex-col gap-3 p-3"
        >
          <span className="text-11 text-[var(--text-tertiary)]">仅开发版可见</span>
          <PreviewRow title="模拟出错">
            {/* One entry: the scenarios are chosen in their panel. */}
            <Button
              variant="secondary"
              size="md"
              className="w-full"
              title="模拟期间所有修改都不会发到云端 Cindy"
              onClick={() => {
                openCloudScenarios();
                setOpen(false);
              }}
            >
              打开异常场景面板
            </Button>
          </PreviewRow>
        </PopoverContent>
      </Popover>
    </div>,
    document.body,
  );
}
