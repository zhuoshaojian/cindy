import { useCallback, useState } from 'react';
import { SegmentedControl } from '@/components/ui/segmented-control';

/**
 * Design alternatives the owner is still choosing between (2026-11-06). Dev builds only, in Chinese
 * only, and kept on this computer: delete this file once a choice is made. Add further alternatives
 * as more rows.
 */
export type CloudCardPlacement = 'pinned' | 'folded';

const PLACEMENT_KEY = 'cloud-preview:card-placement';

export function useCloudCardPlacement() {
  const [placement, setPlacement] = useState<CloudCardPlacement>(() =>
    import.meta.env.DEV && localStorage.getItem(PLACEMENT_KEY) === 'folded' ? 'folded' : 'pinned',
  );
  const choose = useCallback((next: CloudCardPlacement) => {
    localStorage.setItem(PLACEMENT_KEY, next);
    setPlacement(next);
  }, []);
  return [placement, choose] as const;
}

export function CloudPreviewSwitches({
  placement,
  onPlacementChange,
}: {
  placement: CloudCardPlacement;
  onPlacementChange(next: CloudCardPlacement): void;
}) {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      data-cloud-preview
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--border-default)] px-4 py-3"
    >
      <span className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <span className="text-13 font-medium text-[var(--text-primary)]">
          方案切换：云端 Cindy 放在哪
        </span>
        <span className="text-12 text-[var(--text-secondary)]">仅开发版可见，定稿后删除</span>
      </span>
      <SegmentedControl
        aria-label="云端 Cindy 放在哪"
        value={placement}
        onValueChange={onPlacementChange}
        options={[
          { value: 'pinned', label: '默认展示' },
          { value: 'folded', label: '收进我的设备' },
        ]}
      />
    </div>
  );
}
