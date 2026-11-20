import { describe, expect, it, vi } from 'vitest';
import { PictureClipboard } from '../pictureClipboard';

// Unit tier: the decision alone; the computer is a recorded push.
const computerChord = { shortcut: true, remoteChord: true };
const macChord = { shortcut: true, remoteChord: false };

function fixture() {
  const pushed: string[] = [];
  const push = vi.fn(async (text: string) => {
    pushed.push(text);
  });
  const clipboard = new PictureClipboard();
  const paste = (text: string, how = computerChord) => clipboard.paste({ text, ...how }, push);
  return { clipboard, paste, pushed, push };
}

describe('a paste into the remote picture from a browser', () => {
  it('Cmd+V on a Mac always pastes the local text, even right after a copy on the computer', async () => {
    const { clipboard, paste, pushed } = fixture();
    expect(paste('notes', macChord).forward).toBe(false);
    clipboard.copy();
    const again = paste('notes', macChord);
    expect(again.forward).toBe(false);
    await again.done;
    expect(pushed).toEqual(['notes', 'notes']);
  });

  it("the computer's own chord pastes new local text once, then the computer's clipboard", async () => {
    const { paste, pushed } = fixture();
    const first = paste('from this computer');
    expect(first.forward).toBe(false);
    await first.done;
    // Unchanged local text: the computer already has it, or has copied something newer since.
    expect(paste('from this computer').forward).toBe(true);
    const next = paste('copied again here');
    expect(next.forward).toBe(false);
    await next.done;
    expect(pushed).toEqual(['from this computer', 'copied again here']);
  });

  it('a copy typed into the picture keeps the next paste on the computer while the page keeps focus', async () => {
    const { clipboard, paste, pushed } = fixture();
    clipboard.copy();
    // The local text predates that copy: it can only change while the page is in the background.
    const kept = paste('older local text');
    expect(kept.forward).toBe(true);
    await kept.done;
    expect(pushed).toEqual([]);
    // Left and came back with a new local copy: that one is newer.
    clipboard.copy();
    clipboard.blur();
    const fresh = paste('copied elsewhere');
    expect(fresh.forward).toBe(false);
    await fresh.done;
    expect(pushed).toEqual(['copied elsewhere']);
  });

  it('an empty local clipboard leaves the paste to the computer, and is reported for a menu paste', async () => {
    const { paste, push } = fixture();
    expect(paste('').forward).toBe(true);
    const menu = paste('', { shortcut: false, remoteChord: false });
    expect(menu.forward).toBe(false);
    await expect(menu.done).rejects.toThrow('CLIPBOARD_EMPTY');
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps pastes in order: a forwarded key waits for the push before it', async () => {
    const { paste, push } = fixture();
    let finish!: () => void;
    push.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const first = paste('first');
    const second = paste('first');
    expect(second.forward).toBe(true);
    let opened = false;
    void second.done.then(() => (opened = true));
    await Promise.resolve();
    expect(opened).toBe(false);
    finish();
    await first.done;
    await second.done;
    expect(opened).toBe(true);
  });

  it('a push that failed is tried again by the next paste of the same text', async () => {
    const { paste, push } = fixture();
    push.mockRejectedValueOnce(new Error('CLIPBOARD_TOO_LONG'));
    await expect(paste('large').done).rejects.toThrow('CLIPBOARD_TOO_LONG');
    const retry = paste('large');
    expect(retry.forward).toBe(false);
    await retry.done;
    expect(push).toHaveBeenCalledTimes(2);
  });
});
