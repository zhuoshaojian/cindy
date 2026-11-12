import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInRouterContext, useNavigate, type NavigateFunction } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDeviceLinkDeviceList } from '@/features/device-link/useDeviceLinkDeviceList';
import { useCloudStage } from './cloudFaults';
import {
  CLOUD_SCENARIOS,
  DEMO_GROUPS,
  PLAY_UPDATE_HINT,
  PLAY_UPDATE_OUTCOMES,
  endCloudScenarios,
  foldCloudScenarios,
  playCloudUpdate,
  showCloudFrame,
  useCloudScenarios,
  type PlayUpdateOutcome,
} from './cloudFaultScripts';
import { cloudInstanceDevicePath } from './cloudInstancesLink';

const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const SAFE = '模拟期间不会改动云端 Cindy，画面一直停在选中的这一帧';
// Without an instance of the owner's own, the frames show one with this id.
const STAGE_DEVICE = `cloud-device-${'0'.repeat(24)}`;
const CLOUD_DEVICE = /^cloud-device-[a-f0-9]{24}$/;
// Rows sized as in the settings sidebar (SettingsSidebarNav). The panel floats over the page, so it
// sits on the dialog panel's opaque card (--confirm-bg): --settings-bg turns transparent under a
// wallpaper or desktop background (globals.css), which let the page show through. The frame shown
// takes the selected ink (--settings-menu-bg-selected), which reads on that card in every theme;
// the sidebar's active pill is near white in light and matches the card.
const ROW = 'flex h-9 w-full items-center gap-2.5 rounded-full px-3 text-left text-sm transition-colors';
const ROW_IDLE = 'text-[var(--settings-menu-text)] hover:bg-sidebar-item-hover';
const ROW_ACTIVE = 'bg-[var(--settings-menu-bg-selected)] font-medium text-[var(--text-primary)]';
const GROUP_HEADING = 'px-3 pb-1 pt-2.5 text-12 font-medium text-[var(--text-tertiary)]';

/**
 * The scenario panel (owner, 2026-11-11: "点了就生效"; earlier "这个小面板真难用 场景也看不清").
 * Scenarios by where they happen, each named in full; opening one lists its frames, and choosing a
 * frame shows it at once on the page it belongs to, where it stays until another is chosen or the
 * simulation ends. The frame in force is named at the top and marked in the list. It sits bottom
 * right, or bottom left while that covers a dialog or menu the frame shows, and folds into a pill.
 * Dev builds only, for admitted accounts.
 *
 * @param raised Above the dev options button, where that button is.
 */
export function CloudFaultBeacon({ raised = false }: { raised?: boolean }) {
  // Outside a router (a page fixture) a frame is still shown; only going to its page is left out.
  return useInRouterContext() ? <RoutedBeacon raised={raised} /> : <Beacon raised={raised} />;
}
function RoutedBeacon({ raised }: { raised: boolean }) {
  return <Beacon raised={raised} navigate={useNavigate()} />;
}
function Beacon({ raised, navigate }: { raised: boolean; navigate?: NavigateFunction }) {
  const stage = useCloudStage();
  const { open, folded } = useCloudScenarios();
  const shown = open || !!stage;
  // Read only once the panel shows: the device list starts its own requests.
  return shown ? <Panel raised={raised} navigate={navigate} folded={folded} /> : null;
}
function Panel({
  raised,
  navigate,
  folded,
}: {
  raised: boolean;
  navigate?: NavigateFunction;
  folded: boolean;
}) {
  const stage = useCloudStage();
  const devices = useDeviceLinkDeviceList();
  const [expanded, setExpanded] = useState<string | null>(stage?.scenario ?? null);
  // Owner, 2026-11-11 ("verify patterns, not instances"): the 验收清单 first; every other frame
  // under 全部画面, folded until opened (or while one of them is shown).
  const [allOpen, setAllOpen] = useState(false);
  const checklist = CLOUD_SCENARIOS.flatMap((item) =>
    item.frames.flatMap((frame, index) => (frame.check ? [{ item, frame, index }] : [])),
  );
  const total = CLOUD_SCENARIOS.reduce((sum, item) => sum + item.frames.length, 0);
  const showingOther =
    !!stage && !stage.play && !checklist.some(({ item, index }) => item.id === stage.scenario && index === stage.frame);
  // 亲手体验: the outcome the next run of the update flow ends with.
  const [outcome, setOutcome] = useState<PlayUpdateOutcome>('done');
  const [left, setLeft] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stage) setExpanded(stage.scenario);
  }, [stage?.scenario]);
  useEffect(() => {
    const check = () => {
      const own = panel.current?.getBoundingClientRect();
      if (!own) return;
      // Where it would sit on the right, whichever side it is on now.
      const right = new DOMRect(window.innerWidth - 16 - own.width, own.top, own.width, own.height);
      setLeft(
        [...document.querySelectorAll<HTMLElement>('[role=dialog], [role=menu], [role=alertdialog]')].some(
          (element) =>
            !panel.current?.contains(element) &&
            element.getAttribute('aria-label') !== '开发选项' &&
            overlaps(right, element.getBoundingClientRect()),
        ),
      );
    };
    check();
    const timer = window.setInterval(check, 500);
    return () => window.clearInterval(timer);
  }, []);
  const target = () =>
    stage?.deviceId ??
    devices?.find((device) => !device.isSelf && CLOUD_DEVICE.test(device.deviceId))?.deviceId ??
    STAGE_DEVICE;
  // The run starts on the card, where the owner opens the updates dialog themselves.
  const play = () => {
    const deviceId = target();
    playCloudUpdate(outcome, deviceId);
    navigate?.(cloudInstanceDevicePath(deviceId));
  };
  const choose = (scenarioId: string, index: number) => {
    const deviceId = target();
    showCloudFrame(scenarioId, index, deviceId);
    const tab = CLOUD_SCENARIOS.find((item) => item.id === scenarioId)?.frames[index]?.world(deviceId)
      .settings?.tab;
    // Each frame on its own page: the instance's settings, or its card on My devices.
    if (tab)
      navigate?.(`/cloud-settings?${new URLSearchParams({ deviceId, tab })}`, {
        state: { returnTo: cloudInstanceDevicePath(deviceId) },
      });
    else navigate?.(cloudInstanceDevicePath(deviceId));
  };
  const scenario = stage && CLOUD_SCENARIOS.find((item) => item.id === stage.scenario);
  const current = stage && scenario?.frames[stage.frame];
  // Above a frame's dialog, and still clickable while a modal one holds the rest of the window.
  const place = `pointer-events-auto fixed z-[10001] ${left ? 'left-4' : 'right-4'} ${raised && !left ? 'bottom-14' : 'bottom-4'}`;
  if (folded)
    return createPortal(
      <div ref={panel} className={place}>
        <Button
          size="md"
          variant="secondary"
          className="shadow-[var(--shadow-menu)]"
          title={SAFE}
          onClick={() => foldCloudScenarios(false)}
        >
          {stage && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--error-fg)]" />}
          {stage?.play
            ? `亲手体验 · ${stage.play.phase}`
            : stage
              ? `场景 · ${stage.code} ${stage.name}`
              : '场景'}
        </Button>
      </div>,
      document.body,
    );
  return createPortal(
    <div
      ref={panel}
      data-cloud-fault-beacon
      role="region"
      aria-label="异常场景"
      className={`${place} flex max-h-[80vh] w-[min(400px,calc(100vw-32px))] flex-col rounded-lg border border-[var(--border-default)] bg-[var(--confirm-bg)] shadow-[var(--shadow-menu)]`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-default)] py-2 pl-3 pr-2">
        <span className="min-w-0 flex-1 text-14 font-semibold text-[var(--text-primary)]">异常场景</span>
        <Button size="md" variant="secondary" disabled={!stage} onClick={endCloudScenarios}>
          结束模拟
        </Button>
        <Button size="md" variant="secondary" aria-label="收起" title="收起" onClick={() => foldCloudScenarios(true)}>
          <ChevronDown size={16} />
        </Button>
      </div>
      {/* What is on screen now, in words: the one thing to read first. */}
      <div role="status" className="flex shrink-0 flex-col gap-0.5 border-b border-[var(--border-default)] px-3 py-2.5">
        {stage?.play ? (
          <>
            <span className="text-12 text-[var(--text-tertiary)]">正在显示</span>
            <span className="text-14 font-medium leading-[1.4] text-[var(--text-primary)]">
              {`亲手体验 · ${stage.play.outcome} · ${stage.play.phase}`}
            </span>
            <span className="text-12 leading-[1.5] text-[var(--text-secondary)]">{PLAY_UPDATE_HINT}</span>
          </>
        ) : stage && scenario && current ? (
          <>
            <span className="text-12 text-[var(--text-tertiary)]">正在显示</span>
            <span className="text-14 font-medium leading-[1.4] text-[var(--text-primary)]">
              {`${current.code} ${scenario.name} · ${current.name}`}
            </span>
            {current.note && (
              <span className="text-12 leading-[1.5] text-[var(--text-secondary)]">{current.note}</span>
            )}
          </>
        ) : (
          <span className="text-13 text-[var(--text-secondary)]">选一个场景，再点一帧画面，页面立刻变成那样</span>
        )}
        <span className="text-12 leading-[1.5] text-[var(--text-tertiary)]">{SAFE}</span>
      </div>
      <div className="min-h-0 overflow-y-auto px-2 pb-2">
        {/* Owner, 2026-11-12: try a flow with their own clicks, not just look at its frames. */}
        <section className="pt-2" aria-label="亲手体验">
          <h3 className="px-3 pb-0.5 text-13 font-semibold text-[var(--text-primary)]">亲手体验</h3>
          <h4 className={GROUP_HEADING}>更新流程 · 选一个结果，再点开始</h4>
          <div role="radiogroup" aria-label="更新流程的结果" className="flex flex-col gap-0.5">
            {PLAY_UPDATE_OUTCOMES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={outcome === item.id}
                // A setting, not what is on screen: marked as the client's menu radio items
                // (DropdownMenuRadioItem), a dot in a circle and medium weight, without the fill.
                className={`${ROW} ${ROW_IDLE} ${outcome === item.id ? 'font-medium text-[var(--text-primary)]' : ''}`}
                onClick={() => setOutcome(item.id)}
              >
                <span aria-hidden className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {outcome === item.id && <RadioDot />}
                </span>
                <span className="min-w-0 flex-1 truncate leading-none" title={item.label}>
                  {item.label}
                </span>
              </button>
            ))}
          </div>
          <div className="flex justify-end px-1 pt-1.5">
            <Button size="md" variant="primary" onClick={play}>
              {stage?.play ? '重新开始' : '开始'}
            </Button>
          </div>
        </section>
        <section className="pt-2">
          <h3 className="px-3 pb-0.5 text-13 font-semibold text-[var(--text-primary)]">
            {`验收清单 · ${checklist.length} 帧`}
          </h3>
          {/* Owner, 2026-11-11: by what the user is looking at, each row only its state. */}
          {DEMO_GROUPS.map((group) => {
            const rows = checklist.filter(({ item }) => item.group === group);
            return rows.length ? (
              <section key={group} aria-label={group}>
                <h4 className={GROUP_HEADING}>{group}</h4>
                <ul className="flex flex-col gap-0.5">
                  {rows.map(({ item, frame, index }) => (
                    <li key={`${item.id}-${index}`}>
                      <FrameButton
                        code={frame.code}
                        name={frame.label ?? frame.name}
                        selected={stage?.scenario === item.id && stage.frame === index}
                        onClick={() => choose(item.id, index)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null;
          })}
        </section>
        <section className="pt-2">
          <button
            type="button"
            aria-expanded={allOpen || showingOther}
            className="flex h-9 w-full items-center gap-1.5 rounded-full px-3 text-left text-13 font-semibold text-[var(--text-primary)] hover:bg-sidebar-item-hover"
            onClick={() => setAllOpen(!(allOpen || showingOther))}
          >
            {allOpen || showingOther ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            {`全部画面 · ${total} 帧`}
          </button>
          {(allOpen || showingOther) && DEMO_GROUPS.map((group) => (
          <section key={group} aria-label={group}>
            <h4 className={GROUP_HEADING}>{group}</h4>
            <ul className="flex flex-col gap-0.5">
              {CLOUD_SCENARIOS.filter((item) => item.group === group).map((item) => {
                const isOpen = expanded === item.id;
                const ours = stage?.scenario === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      className={`${ROW} ${ROW_IDLE} ${ours ? 'font-medium' : ''}`}
                      onClick={() => setExpanded(isOpen ? null : item.id)}
                    >
                      {isOpen ? (
                        <ChevronDown size={14} aria-hidden className="shrink-0 text-[var(--text-tertiary)]" />
                      ) : (
                        <ChevronRight size={14} aria-hidden className="shrink-0 text-[var(--text-tertiary)]" />
                      )}
                      <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
                      {ours && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--error-fg)]" />}
                      <span className="shrink-0 text-11 text-[var(--text-tertiary)]">{`${item.code} · ${item.frames.length}`}</span>
                    </button>
                    {isOpen && (
                      <ul className="flex flex-col gap-0.5 pb-1.5 pl-6 pt-0.5" aria-label={item.name}>
                        {item.frames.map((frame, index) => (
                          <li key={`${frame.code}-${index}`}>
                            <FrameButton
                              code={frame.code}
                              name={frame.name}
                              selected={ours && stage?.frame === index}
                              onClick={() => choose(item.id, index)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          ))}
        </section>
      </div>
    </div>,
    document.body,
  );
}

/** The client's menu radio indicator (DropdownMenuRadioItem in components/ui/dropdown-menu.tsx). */
function RadioDot() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M7.49991 0.876953C3.84222 0.876953 0.877075 3.8421 0.877075 7.49979C0.877075 11.1575 3.84222 14.123 7.49991 14.123C11.1576 14.123 14.1227 11.1575 14.1227 7.49979C14.1227 3.8421 11.1576 0.876953 7.49991 0.876953ZM7.49991 1.82695C10.6329 1.82695 13.1727 4.3668 13.1727 7.49979C13.1727 10.6328 10.6329 13.173 7.49991 13.173C4.36692 13.173 1.82708 10.6328 1.82708 7.49979C1.82708 4.3668 4.36692 1.82695 7.49991 1.82695ZM7.49991 4.37695C5.77492 4.37695 4.37708 5.77479 4.37708 7.49979C4.37708 9.22479 5.77492 10.623 7.49991 10.623C9.22491 10.623 10.6227 9.22479 10.6227 7.49979C10.6227 5.77479 9.22491 4.37695 7.49991 4.37695Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** One frame in the panel: its state, and its code small at the end; the one shown is active. */
function FrameButton({
  code,
  name,
  selected,
  onClick,
}: {
  code: string;
  name: string;
  selected: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={`${ROW} ${selected ? ROW_ACTIVE : ROW_IDLE}`}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate leading-none" title={name}>{name}</span>
      <span className="shrink-0 text-11 font-normal text-[var(--text-tertiary)]">{code}</span>
    </button>
  );
}
