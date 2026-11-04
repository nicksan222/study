/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Attaches the Study RPC group to a dedicated Effect scope using the application’s   │
 * │ shared service context. Closing the returned server shuts down the listener and active   │
 * │ requests.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports ServeOptions, serve. Closing the returned server shuts down the listener and   │
 * │   active requests.                                                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses StudyRpc and serveRpc; the returned Effect scope owns the listener and active       │
 * │ requests.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts/rpc';
import { Effect, Exit, Layer, Scope } from 'effect';
import { HttpRouter } from 'effect/http';

import { authCallbackRoutes } from '#server/features/auth/http/index';
import { serveRpc } from '#server/platform/rpc/node';

import { runNative } from './layers.ts';
import type { App } from './service.ts';

export interface ServeOptions {
  port?: number;
  allowedOrigins?: readonly string[];
}

/** The HTTP listener and all requests belong to a dedicated Effect scope. */
export async function serve(app: App, options: ServeOptions = {}) {
  const scope = Scope.makeUnsafe();

  try {
    const services = await app.nativeRuntime.context();
    const handlers = app.native.handlers.pipe(Layer.provide(Layer.succeedContext(services)));
    const server = await runNative(
      serveRpc({
        group: StudyRpc,
        handlers,
        routes: authCallbackRoutes.pipe(HttpRouter.provideRequest(Layer.succeedContext(services))),
        ...options
      }).pipe(Effect.provideService(Scope.Scope, scope))
    );
    let closing: Promise<void> | undefined;

    return {
      url: server.url,
      close: () => (closing ??= runNative(Scope.close(scope, Exit.void)))
    };
  } catch (error) {
    await runNative(Scope.close(scope, Exit.void));

    throw error;
  }
}
