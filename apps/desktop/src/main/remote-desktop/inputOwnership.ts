// Process-local arbitration: a human and an Agent cannot inject simultaneously.
let human = false;
let actions = 0;
export function isHumanDesktopInputActive(): boolean {
  return human;
}
export function isDesktopInputBusy(): boolean {
  return human || actions > 0;
}
export function acquireHumanDesktopInput(): () => void {
  if (human || actions > 0) throw new Error('DESKTOP_INPUT_BUSY');
  human = true;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      human = false;
    }
  };
}
export function holdDesktopInputAction(): () => void {
  if (human)
    throw new Error('Desktop input is in use by a person. Retry after they release control.');
  actions++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    actions--;
  };
}
export async function withAgentDesktopInput<T>(run: () => Promise<T>): Promise<T> {
  const release = holdDesktopInputAction();
  try {
    return await run();
  } finally {
    release();
  }
}
