/**
 * What a paste into the remote picture means in a browser. A browser hands a
 * page the local clipboard only inside its paste event and offers no way to read
 * the computer's, so the native clipboard sync is unavailable here.
 *
 * - A paste chord the computer does not use itself (Cmd+V on a Mac controlling
 *   Linux), or a paste from the browser's menu, always pastes the local text.
 * - The computer's own chord (Ctrl+V from Windows or Linux) pastes the local text
 *   when it changed since the last paste here, unless a copy was typed into the
 *   picture after that while the page kept focus: then the computer holds the
 *   newer copy and the keys go through, as when copying and pasting entirely on
 *   it. Local text cannot change while the page has focus.
 *
 * Pushes run one at a time, and a forwarded key waits for the earlier ones, so
 * pastes reach the computer in the order they were made.
 */
export class PictureClipboard {
  /** The local text the last paste here saw. */
  private seen: string | null = null;
  /** A copy typed into the picture since then, and whether focus left after it. */
  private copied: 'here' | 'away' | null = null;
  private queue: Promise<void> = Promise.resolve();

  copy(): void {
    this.copied = 'here';
  }

  blur(): void {
    if (this.copied === 'here') this.copied = 'away';
  }

  paste(
    paste: { text: string; shortcut: boolean; remoteChord: boolean },
    push: (text: string) => Promise<void>,
  ): { forward: boolean; done: Promise<void> } {
    const { text, shortcut, remoteChord } = paste;
    const copied = this.copied;
    const changed = text !== this.seen;
    this.copied = null;
    // Only the computer's own chord can mean its own clipboard.
    const computerChord = shortcut && remoteChord;
    if (!text) {
      if (computerChord) return { forward: true, done: this.queue };
      return { forward: false, done: Promise.reject(new Error('CLIPBOARD_EMPTY')) };
    }
    this.seen = text;
    if (computerChord && (!changed || copied === 'here')) return { forward: true, done: this.queue };
    const done = this.queue.then(() => push(text));
    this.queue = done.catch(() => {
      // Not on the computer after all: the next paste of this text tries again.
      if (this.seen === text) this.seen = null;
    });
    return { forward: false, done };
  }
}
