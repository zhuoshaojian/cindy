import { chmod, unlink } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

/**
 * Cross-repository wire twins live in
 * cindy-server/cloud-instance-server/src/provider-shared.ts. Change both
 * literals and both repositories' contract tests together.
 */
export const POD_DELETE_CONTROL_SOCKET = '/tmp/cindy-cloud-delete-control.sock';
export const POD_DELETE_CREDENTIALS_PATH = '/v1/delete-credentials';

export interface PodDeleteControlLogger {
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
}

export interface PodDeleteControlServer {
  start(): Promise<void>;
  close(): Promise<void>;
}

interface PodDeleteControlOptions {
  clearCredentials: () => void;
  credentialsAbsent: () => boolean;
  logger: PodDeleteControlLogger;
  socketPath?: string;
}

async function unlinkIfPresent(socketPath: string): Promise<void> {
  try {
    await unlink(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Container-internal delete barrier. The Unix socket is never published or
 * mounted as a public endpoint; only a provider exec inside this Pod can reach
 * it. The HTTP response is the acknowledgement and is emitted only after both
 * durable Account credential files are proven absent.
 */
export function createPodDeleteControlServer(
  options: PodDeleteControlOptions,
): PodDeleteControlServer {
  const socketPath = options.socketPath ?? POD_DELETE_CONTROL_SOCKET;
  let server: Server | null = null;
  let cleanupInFlight: Promise<void> | null = null;

  const runCleanup = (): Promise<void> => {
    cleanupInFlight ??= Promise.resolve()
      .then(() => {
        options.clearCredentials();
        if (!options.credentialsAbsent()) {
          throw new Error('durable Pod Account credentials remain after cleanup');
        }
      })
      .finally(() => {
        cleanupInFlight = null;
      });
    return cleanupInFlight;
  };

  return {
    async start(): Promise<void> {
      if (server) return;
      await unlinkIfPresent(socketPath);
      const nextServer = createServer((request, response) => {
        if (
          request.method !== 'POST'
          || request.url !== POD_DELETE_CREDENTIALS_PATH
        ) {
          response.writeHead(404).end();
          return;
        }
        void runCleanup().then(
          () => {
            options.logger.info('Pod delete credential cleanup acknowledged');
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end('{"cleared":true}\n');
          },
          () => {
            options.logger.warn('Pod delete credential cleanup failed');
            response.writeHead(500, { 'content-type': 'application/json' });
            response.end('{"cleared":false}\n');
          },
        );
      });
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          nextServer.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          nextServer.off('error', onError);
          resolve();
        };
        nextServer.once('error', onError);
        nextServer.once('listening', onListening);
        nextServer.listen(socketPath);
      });
      try {
        await chmod(socketPath, 0o600);
      } catch (error) {
        await new Promise<void>((resolve) => nextServer.close(() => resolve()));
        await unlinkIfPresent(socketPath);
        throw error;
      }
      server = nextServer;
    },

    async close(): Promise<void> {
      const current = server;
      server = null;
      if (current) {
        await new Promise<void>((resolve, reject) => {
          current.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
      await unlinkIfPresent(socketPath);
    },
  };
}
