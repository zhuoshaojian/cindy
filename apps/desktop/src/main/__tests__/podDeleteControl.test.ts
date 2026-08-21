import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPodDeleteControlServer,
  POD_DELETE_CONTROL_SOCKET,
  POD_DELETE_CREDENTIALS_PATH,
} from '../cloud-runtime/pod-delete-control.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

async function request(socketPath: string, method = 'POST'): Promise<{
  statusCode: number;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
      path: POD_DELETE_CREDENTIALS_PATH,
      method,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode ?? 0,
        body,
      }));
    });
    req.once('error', reject);
    req.end();
  });
}

async function socketPath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cindy-pod-delete-control-'));
  tempDirectories.push(directory);
  return path.join(directory, 'control.sock');
}

describe('Pod delete credential control', () => {
  it('keeps the Unix socket and HTTP path aligned with the control plane', () => {
    expect(POD_DELETE_CONTROL_SOCKET).toBe('/tmp/cindy-cloud-delete-control.sock');
    expect(POD_DELETE_CREDENTIALS_PATH).toBe('/v1/delete-credentials');
  });

  it('acknowledges only after durable Account credentials are absent', async () => {
    const socket = await socketPath();
    let absent = false;
    const clearCredentials = vi.fn(() => { absent = true; });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const control = createPodDeleteControlServer({
      socketPath: socket,
      clearCredentials,
      credentialsAbsent: () => absent,
      logger,
    });
    await control.start();

    await expect(request(socket)).resolves.toEqual({
      statusCode: 200,
      body: '{"cleared":true}\n',
    });
    expect(clearCredentials).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith('Pod delete credential cleanup acknowledged');

    await control.close();
    await expect(fs.stat(socket)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not acknowledge a failed physical credential removal', async () => {
    const socket = await socketPath();
    const control = createPodDeleteControlServer({
      socketPath: socket,
      clearCredentials: vi.fn(),
      credentialsAbsent: () => false,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    await control.start();

    await expect(request(socket)).resolves.toEqual({
      statusCode: 500,
      body: '{"cleared":false}\n',
    });
    await control.close();
  });

  it('rejects non-delete-control requests without touching credentials', async () => {
    const socket = await socketPath();
    const clearCredentials = vi.fn();
    const control = createPodDeleteControlServer({
      socketPath: socket,
      clearCredentials,
      credentialsAbsent: () => true,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    await control.start();

    await expect(request(socket, 'GET')).resolves.toMatchObject({ statusCode: 404 });
    expect(clearCredentials).not.toHaveBeenCalled();
    await control.close();
  });
});
