import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { DesktopInputHost } from '../inputHost';
import { withAgentDesktopInput } from '../inputOwnership';
import { LinuxDesktopInput } from '../linuxInput';

vi.mock('electron', () => ({
  app: {},
  screen: { getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } }] },
}));
function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    pid: 1,
    stdout: new EventEmitter(),
    stderr: { resume() {} },
    stdin: Object.assign(new EventEmitter(), {
      destroyed: false,
      writableLength: 0,
      write: vi.fn(),
      end: vi.fn(),
    }),
    exitCode: null as number | null,
    signalCode: null,
    kill: vi.fn(),
  });
  return {
    child,
    typed: child as unknown as ChildProcessWithoutNullStreams,
    exit: () => {
      child.exitCode = 0;
      child.emit('exit', 0);
      child.emit('close', 0);
    },
  };
}
describe('native input lifecycle', () => {
  it('keeps Linux input ownership until X11 cleanup and its guard have exited', async () => {
    let finish!: () => void;
    const linux = new LinuxDesktopInput({
      current: async () => true,
      command: async () => '',
      insertText: async () => {},
      close: () => new Promise<void>((resolve) => { finish = resolve; }),
    }, vi.fn());
    const native = vi.spyOn(linux, 'input');
    const host = new DesktopInputHost(vi.fn(), {
      platform: 'linux', openLinuxInput: async () => linux,
      resolveBinary: vi.fn(), spawn: vi.fn(),
    });
    await host.start('1');
    host.input([{ kind: 'move', x: 0.5, y: 1 }]);
    expect(native).toHaveBeenCalledWith([{ kind: 'move', x: 50, y: 99 }]);
    await linux.settled();
    host.stop();
    await expect(withAgentDesktopInput(async () => {})).rejects.toThrow('person');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish();
    await vi.waitFor(async () => {
      await expect(withAgentDesktopInput(async () => {})).resolves.toBeUndefined();
    });
  });

  it('closes a Linux connection that becomes ready after its lease is stopped', async () => {
    const linux = new LinuxDesktopInput({ current: async () => true, command: async () => '', insertText: async () => {} }, vi.fn());
    const stop = vi.spyOn(linux, 'stop');
    let ready!: (input: LinuxDesktopInput) => void;
    const host = new DesktopInputHost(vi.fn(), {
      platform: 'linux', openLinuxInput: () => new Promise((resolve) => { ready = resolve; }),
      resolveBinary: vi.fn(), spawn: vi.fn(),
    });
    const starting = host.start('1');
    await Promise.resolve();
    host.stop();
    ready(linux);
    await expect(starting).rejects.toThrow('EXPIRED');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps Agent input excluded until the old helper has actually exited', async () => {
    const c = childProcess();
    const host = new DesktopInputHost(vi.fn(), {
      platform: 'darwin',
      resolveBinary: async () => '/test/helper',
      spawn: () => {
        queueMicrotask(() => c.child.stdout.emit('data', Buffer.from('ready\n')));
        return c.typed;
      },
    });
    await host.start('1');
    host.stop();
    await expect(withAgentDesktopInput(async () => {})).rejects.toThrow('person');
    expect(c.child.stdin.end).toHaveBeenCalledWith('[{"kind":"release"}]\n');
    c.exit();
    await expect(withAgentDesktopInput(async () => {})).resolves.toBeUndefined();
  });
  it('does not spawn a helper if the lease was stopped during compilation', async () => {
    let resolve!: (value: string) => void;
    const spawn = vi.fn();
    const host = new DesktopInputHost(vi.fn(), {
      platform: 'darwin',
      resolveBinary: () =>
        new Promise((done) => {
          resolve = done;
        }),
      spawn,
    });
    const start = host.start('1');
    await Promise.resolve();
    host.stop();
    resolve('/test/helper');
    await expect(start).rejects.toThrow('EXPIRED');
    expect(spawn).not.toHaveBeenCalled();
    await expect(withAgentDesktopInput(async () => {})).resolves.toBeUndefined();
  });
  it('fails closed rather than writing an oversized native command', async () => {
    const c = childProcess();
    let host: DesktopInputHost;
    const failure = vi.fn(() => host.stop());
    host = new DesktopInputHost(failure, {
      platform: 'darwin',
      resolveBinary: async () => '/test/helper',
      spawn: () => {
        queueMicrotask(() => c.child.stdout.emit('data', Buffer.from('ready\n')));
        return c.typed;
      },
    });
    await host.start('1');
    host.input(Array(3).fill({ kind: 'text', text: '中'.repeat(4096) }));
    expect(failure).toHaveBeenCalledOnce();
    expect(c.child.stdin.write).not.toHaveBeenCalled();
    c.exit();
  });
});
