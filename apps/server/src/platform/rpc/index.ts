/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes native Effect HTTP RPC routes with NDJSON serialization and allowed-      │
 * │ origin policy. It exposes both a web handler with explicit disposal and shared route     │
 * │ construction.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports desktopOrigins, RpcServerOptions, rpcRoutes, createRpcWebHandler. It exposes   │
 * │   both a web handler with explicit disposal and shared route construction.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Runtime/server mounts these routes using canonical RPC contracts; caller Effect scopes   │
 * │ own the listener and in-flight requests.                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { RpcServer, RpcSerialization } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';

export const desktopOrigins = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://localhost:5173'
] as const;

export type RpcServerOptions<R extends Rpc.Any, E> = {
  group: RpcGroup.RpcGroup<R>;
  handlers: Layer.Layer<Rpc.ToHandler<R> | Rpc.Middleware<R> | Rpc.ServicesServer<R>, E>;
  allowedOrigins?: readonly string[];
};

export function rpcRoutes<R extends Rpc.Any, E>(options: RpcServerOptions<R, E>) {
  return RpcServer.layerHttp({ group: options.group, path: '/rpc', protocol: 'http' }).pipe(
    Layer.provide(options.handlers),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.merge(HttpRouter.cors({ allowedOrigins: options.allowedOrigins ?? desktopOrigins }))
  );
}

/** Create a scoped native Effect HTTP RPC endpoint. Dispose it on server shutdown. */
export function createRpcWebHandler<R extends Rpc.Any, E>(options: RpcServerOptions<R, E>) {
  const routes = rpcRoutes(options);
  const app = HttpRouter.toWebHandler(routes as Layer.Layer<never, E, HttpRouter.HttpRouter>, {
    disableLogger: true
  });
  const origins = new Set(options.allowedOrigins ?? desktopOrigins);

  return {
    handler: (request: Request) => {
      const origin = request.headers.get('origin');

      if (origin && !origins.has(origin))
        return Promise.resolve(new Response(null, { status: 403 }));

      return app.handler(request);
    },
    dispose: app.dispose
  };
}
