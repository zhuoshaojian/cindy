import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { executeOnceMock } = vi.hoisted(() => ({
  executeOnceMock: vi.fn(),
}));

vi.mock('../downloader/transport.js', () => ({
  executeOnce: executeOnceMock,
}));

import { Scheduler } from '../downloader/scheduler.js';
import { DownloadError } from '../downloader/types.js';

afterEach(() => {
  vi.restoreAllMocks();
  executeOnceMock.mockReset();
});

describe('downloader scheduler rejection ownership', () => {
  it('does not create an unhandled derived rejection while evicting a failed flight', async () => {
    executeOnceMock.mockRejectedValue(
      new DownloadError('HTTP_4XX', 'offline test failure'),
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const scheduler = new Scheduler({ maxConcurrent: 1 });
      await expect(
        scheduler.enqueue({
          url: 'https://example.invalid/agent',
          targetPath: path.join(process.cwd(), '.missing-download-target'),
          sha256: '0'.repeat(64),
        }),
      ).rejects.toThrow('offline test failure');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
