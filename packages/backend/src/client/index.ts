import { createTRPCClient, httpLink, httpSubscriptionLink, TRPCClientError } from '@trpc/client';
import type { TRPCClient, TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';

import type { AppRouter } from '#backend/runtime/router';

export type StudyClient = TRPCClient<AppRouter>;

export type StudyClientOptions = {
  baseUrl: string | (() => string | Promise<string>);
  EventSource?: typeof EventSource;
};

/** One inferred client for browser and Node consumers; discovery never replays a mutation. */
export function createStudyClient(options: StudyClientOptions): StudyClient {
  let connection: Promise<string> | undefined;
  const discover = () => {
    if (!connection) {
      const pending = Promise.resolve().then(async () => {
        const base =
          typeof options.baseUrl === 'function' ? await options.baseUrl() : options.baseUrl;

        return `${base.replace(/\/$/, '')}/trpc`;
      });

      connection = pending;
      void pending.catch(() => invalidate(pending));
    }

    return connection;
  };
  const invalidate = (pending: Promise<string>) => {
    // An old in-flight failure must not evict a newer connection.
    if (connection === pending) connection = undefined;
  };
  const link: TRPCLink<AppRouter> =
    (runtime) =>
    ({ op, next }) =>
      observable((observer) => {
        let stopped = false;
        let subscription: { unsubscribe(): void } | undefined;
        let pending = discover();

        void pending
          .then((url) => {
            if (stopped) return;

            const transport =
              op.type === 'subscription'
                ? httpSubscriptionLink<AppRouter, typeof EventSource>({
                    url: async () => {
                      pending = discover();

                      return pending;
                    },
                    transformer: superjson,
                    EventSource: options.EventSource
                  })
                : httpLink<AppRouter>({ url, transformer: superjson });

            subscription = transport(runtime)({
              op,
              next
            }).subscribe({
              next(value) {
                if (
                  value.result.type === 'state' &&
                  value.result.state === 'connecting' &&
                  value.result.error
                )
                  invalidate(pending);

                observer.next(value);
              },
              error(error) {
                if (!op.signal?.aborted && (!error.data || error.data.kind === 'transient'))
                  invalidate(pending);

                observer.error(error);
              },
              complete() {
                if (op.type === 'subscription' && !stopped && !op.signal?.aborted)
                  invalidate(pending);

                observer.complete();
              }
            });
          })
          .catch((error: unknown) =>
            observer.error(
              TRPCClientError.from(error instanceof Error ? error : new Error(String(error)))
            )
          );

        return () => {
          stopped = true;
          subscription?.unsubscribe();
        };
      });

  return createTRPCClient<AppRouter>({ links: [link] });
}
