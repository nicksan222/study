import { createServer } from 'node:http';

import { NodeHttpServer } from '@effect/platform-node';
import { Context, Effect, Layer } from 'effect';
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';
import { NetAddress } from 'effect/net';
import type { Rpc } from 'effect/rpc';

import { desktopOrigins, rpcRoutes } from './index.ts';
import type { RpcServerOptions } from './index.ts';

/** The listener and every active request belong to the caller's Effect scope. */
export function serveRpc<R extends Rpc.Any, E>(
  options: RpcServerOptions<R, E> & { port?: number }
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
  const routes = rpcRoutes(options).pipe(Layer.provide(policy.layer));
  const server = HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(
    Layer.provideMerge(
      NodeHttpServer.layer(createServer, {
        host: '127.0.0.1',
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
