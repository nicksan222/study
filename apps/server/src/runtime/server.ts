import { createServer } from 'node:http';
import type { Socket } from 'node:net';

import { createHTTPHandler } from '@trpc/server/adapters/standalone';

import { createProcedureContext } from './procedure-context.ts';
import { appRouter } from './router.ts';
import type { App } from './service.ts';

const desktopOrigins = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://localhost:5173'
] as const;

export interface ServeOptions {
  port?: number;
  allowedOrigins?: readonly string[];
}

/** One loopback HTTP listener serves queries, mutations and official tRPC SSE subscriptions. */
export async function serve(app: App, options: ServeOptions = {}) {
  const shutdown = new AbortController();
  const listeners = new Set<() => void>();
  const refresh = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    publish: () => {
      for (const listener of listeners) listener();
    }
  };
  const unsubscribe = app.subscribe(refresh.publish);
  const adapter = createHTTPHandler({
    router: appRouter,
    basePath: '/trpc/',
    maxBodySize: 20 * 1024 * 1024,
    createContext: () => createProcedureContext(app, refresh, shutdown.signal)
  });
  const origins = new Set(options.allowedOrigins ?? desktopOrigins);
  const http = createServer((request, response) => {
    const origin = request.headers.origin;

    if (origin) {
      if (!origins.has(origin)) {
        response.writeHead(403).end();

        return;
      }

      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'Origin');

      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];

        if (method !== 'GET' && method !== 'POST') {
          response.writeHead(405).end();

          return;
        }

        response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
        response.setHeader(
          'access-control-allow-headers',
          'content-type,trpc-accept,last-event-id'
        );
        response.setHeader('access-control-max-age', '600');
        response.writeHead(204).end();

        return;
      }
    }

    if (!request.url?.startsWith('/trpc/')) {
      response.writeHead(404).end();

      return;
    }

    adapter(request, response);
  });
  const sockets = new Set<Socket>();

  http.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(options.port ?? 0, '127.0.0.1', () => {
        http.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    unsubscribe();
    shutdown.abort();

    for (const socket of sockets) socket.destroy();

    throw error;
  }

  const address = http.address();

  if (!address || typeof address === 'string') throw new Error('No listening address');

  let closing: Promise<void> | undefined;

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      (closing ??= (async () => {
        unsubscribe();
        shutdown.abort();
        refresh.publish();
        const closed = new Promise<void>((resolve, reject) =>
          http.close((error) => (error ? reject(error) : resolve()))
        );

        for (const socket of sockets) socket.destroy();

        await closed;
        listeners.clear();
      })())
  };
}
