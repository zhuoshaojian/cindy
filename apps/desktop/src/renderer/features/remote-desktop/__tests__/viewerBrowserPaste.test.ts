// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountRemoteDesktopViewer } from '@cindy/maker-shared/remote-desktop-viewer';
import { DESKTOP_KEY_CODES, REMOTE_DESKTOP_NETWORK } from '@cindy/device-link';

// Regression: on the cloud web page Cmd/Ctrl+V was sent straight to the computer,
// so the browser never fired its paste event and local text could not be pasted.
// Unit tier: the real shared picture in jsdom; the controller is a scripted answer.
let viewer: ReturnType<typeof mountRemoteDesktopViewer>;
let messages: Record<string, unknown>[];
let answer: ((message: Record<string, unknown>) => void) | null;
let input: HTMLTextAreaElement;

function mount(browserPaste: boolean) {
  messages = [];
  answer = null;
  viewer = mountRemoteDesktopViewer(
    document,
    (message) => {
      messages.push(message);
      if (message.type === 'input')
        viewer.receive({ type: 'ack', epoch: 'lease', sequence: message.sequence });
      if (message.type === 'clipboardPaste') answer?.(message);
    },
    {
      desktop: true,
      net: REMOTE_DESKTOP_NETWORK,
      iceServers: [],
      keyCodes: DESKTOP_KEY_CODES,
      browserPaste,
    },
  );
  // A Linux computer: Ctrl is its copy/paste modifier.
  viewer.receive({ type: 'init', epoch: 'lease', width: 1000, height: 600 });
  viewer.receive({ type: 'control', enabled: true });
  const stage = document.getElementById('stage')!;
  for (const type of ['pointerdown', 'pointerup']) {
    const e = new MouseEvent(type, { clientX: 500, clientY: 352, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    stage.dispatchEvent(e);
  }
  messages = [];
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  document.body.innerHTML =
    '<div id="stage"><div id="bg"><canvas id="bg-canvas"></canvas></div><img id="image"><video id="video"></video><div id="cursor"><img id="cursor-image"></div></div><textarea id="keyboard-input"></textarea><div id="mouse-buttons"><button id="mouse-left"></button><button id="mouse-right"></button><button id="mouse-wheel"><span id="mouse-wheel-grip"></span></button></div>';
  const stage = document.getElementById('stage')!;
  Object.defineProperties(stage, {
    clientWidth: { value: 1000, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });
  stage.setPointerCapture = vi.fn();
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 52,
    left: 0,
    top: 52,
    width: 1000,
    height: 600,
    right: 1000,
    bottom: 652,
    toJSON() {},
  });
  input = document.getElementById('keyboard-input') as HTMLTextAreaElement;
});
afterEach(() => {
  viewer.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const keys = () =>
  messages
    .flatMap((m) => (m.type === 'input' ? (m.events as Record<string, unknown>[]) : []))
    .filter((event) => event.kind === 'key');
const flags = (modifier: 'ctrl' | 'meta') => ({
  ctrlKey: modifier === 'ctrl',
  metaKey: modifier === 'meta',
});
function key(type: 'keydown' | 'keyup', code: string, modifier: 'ctrl' | 'meta', repeat = false) {
  const event = new KeyboardEvent(type, {
    code,
    ...flags(modifier),
    repeat,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(event);
  return event;
}
/** What the browser does after an unprevented paste chord: a paste event on the focused input. */
function browserPaste(text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  input.dispatchEvent(event);
  return event;
}

it('Cmd+V reaches the browser, its text goes to the controller, and the key is dropped when the computer pastes it', () => {
  mount(true);
  answer = () => viewer.receive({ type: 'pasteKey', forward: false });
  key('keydown', 'MetaLeft', 'meta');
  const press = key('keydown', 'KeyV', 'meta');
  // Left to the browser, which fires its paste event only then.
  expect(press.defaultPrevented).toBe(false);
  const paste = browserPaste('hello from the Mac');
  // Never typed from the hidden input as well.
  expect(paste.defaultPrevented).toBe(true);
  expect(messages.filter((m) => m.type === 'clipboardPaste')).toEqual([
    {
      type: 'clipboardPaste',
      text: 'hello from the Mac',
      shortcut: true,
      remoteChord: false,
      epoch: 'lease',
    },
  ]);
  key('keyup', 'KeyV', 'meta');
  key('keyup', 'MetaLeft', 'meta');
  key('keydown', 'KeyA', 'meta');
  vi.advanceTimersByTime(100);
  // Later keys wait behind the gate until the computer has pasted.
  expect(keys()).toEqual([]);
  viewer.receive({ type: 'inputGate' });
  expect(keys().map((event) => [event.code, event.down])).toEqual([
    ['MetaLeft', true],
    ['MetaLeft', false],
    ['KeyA', true],
  ]);
  expect(messages.some((m) => m.type === 'clipboardIntent')).toBe(false);
});

it("forwards the computer's own chord when the controller says its clipboard is the newer one", () => {
  mount(true);
  answer = () => viewer.receive({ type: 'pasteKey', forward: true });
  key('keydown', 'ControlLeft', 'ctrl');
  key('keydown', 'KeyV', 'ctrl');
  browserPaste('older local text');
  expect(messages.find((m) => m.type === 'clipboardPaste')).toMatchObject({ remoteChord: true });
  key('keyup', 'KeyV', 'ctrl');
  key('keyup', 'ControlLeft', 'ctrl');
  viewer.receive({ type: 'inputGate' });
  expect(keys().map((event) => [event.code, event.down])).toEqual([
    ['ControlLeft', true],
    ['KeyV', true],
    ['KeyV', false],
    ['ControlLeft', false],
  ]);
});

it('a chord the browser does not paste with (Ctrl+V on a Mac) is decided with no local text', () => {
  mount(true);
  answer = () => viewer.receive({ type: 'pasteKey', forward: true });
  key('keydown', 'ControlLeft', 'ctrl');
  key('keydown', 'KeyV', 'ctrl');
  expect(messages.some((m) => m.type === 'clipboardPaste')).toBe(false);
  vi.advanceTimersByTime(0);
  expect(messages.filter((m) => m.type === 'clipboardPaste')).toMatchObject([
    { text: '', shortcut: true, remoteChord: true },
  ]);
  key('keyup', 'KeyV', 'ctrl');
  viewer.receive({ type: 'inputGate' });
  expect(keys().map((event) => event.code)).toEqual(['ControlLeft', 'KeyV', 'KeyV']);
});

it('auto-repeat neither pastes again nor reaches the computer, and an unanswered key is never sent', () => {
  mount(true);
  key('keydown', 'MetaLeft', 'meta');
  key('keydown', 'KeyV', 'meta');
  browserPaste('text');
  const repeat = key('keydown', 'KeyV', 'meta', true);
  expect(repeat.defaultPrevented).toBe(true);
  expect(messages.filter((m) => m.type === 'clipboardPaste')).toHaveLength(1);
  key('keyup', 'KeyV', 'meta');
  viewer.receive({ type: 'inputGate' });
  // A late answer finds nothing held.
  viewer.receive({ type: 'pasteKey', forward: true });
  vi.advanceTimersByTime(100);
  expect(keys().map((event) => event.code)).toEqual(['MetaLeft']);
});

it('a native window keeps sending the chord at once and never waits for a paste event', () => {
  mount(false);
  key('keydown', 'ControlLeft', 'ctrl');
  const press = key('keydown', 'KeyV', 'ctrl');
  expect(press.defaultPrevented).toBe(true);
  const paste = browserPaste('ignored');
  expect(paste.defaultPrevented).toBe(false);
  vi.advanceTimersByTime(0);
  expect(messages.some((m) => m.type === 'clipboardPaste')).toBe(false);
  expect(messages.filter((m) => m.type === 'clipboardIntent')).toMatchObject([{ action: 'paste' }]);
});
