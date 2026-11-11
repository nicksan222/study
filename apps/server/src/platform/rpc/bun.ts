/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Serves native Effect RPC on a loopback Bun HTTP listener . The returned Effect     │
 * │ scope owns the server and active requests, with CORS origin checks applied before        │
 * │ dispatch.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports serveRpc. The returned Effect scope owns the server and active requests, with  │
 * │   CORS origin checks applied before dispatch.                                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Runtime/server mounts these routes using canonical RPC contracts; caller Effect scopes   │
 * │ own the listener and in-flight requests.                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunHttpServer } from '@effect/platform-bun';
import { Context, Effect, Layer } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { NetAddress } from 'effect/net';
import type { Rpc } from 'effect/rpc';

import { desktopOrigins, rpcRoutes } from './index.ts';
import type { RpcServerOptions } from './index.ts';

/** The listener and every active request belong to the caller's Effect scope. */
export function serveRpc<R extends Rpc.Any, E>(
  options: RpcServerOptions<R, E> & {
    port?: number;
    routes?: Layer.Layer<never, never, HttpRouter.HttpRouter>;
  }
) {
  const origins = new Set(options.allowedOrigins ?? desktopOrigins);
  const policy = HttpRouter.middleware((request) =>
    Effect.gen(function* () {
      const incoming = yield* HttpServerRequest.HttpServerRequest;
      const origin = incoming.headers.origin;

      if (origin && !origins.has(origin)) return HttpServerResponse.empty({ status: 403 });

      return yield* request;
    })
  );
  const routes = Layer.merge(rpcRoutes(options), options.routes ?? Layer.empty).pipe(
    Layer.provide(policy.layer)
  );
  const server = HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provideMerge(
      BunHttpServer.layer({
        hostname: '127.0.0.1',
        port: options.port ?? 0,
        gracefulShutdownTimeout: '2 seconds'
      })
    )
  );

  return Effect.gen(function* () {
    const services = yield* Layer.build(server);
    const http = Context.get(services, HttpServer.HttpServer);

    return { url: NetAddress.formatUrlUnsafe(http.address) };
  });
}
