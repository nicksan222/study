import { Schema } from 'effect';
import { RpcClientError } from 'effect/rpc';

/** Tracks endpoint reachability without confusing declared feature failures with transport errors. */
export function createServerConnection() {
  let state = { connected: true, revision: 0 };
  const listeners = new Set<() => void>();
  const publish = (connected: boolean) => {
    if (state.connected === connected) return;

    state = { connected, revision: state.revision + 1 };

    for (const listener of listeners) listener();
  };

  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    disconnected: () => publish(false),
    recovered: (revision: number) => {
      if (revision === state.revision) publish(true);
    }
  };
}

export const serverConnection = createServerConnection();

/** Runs before canonical error conversion, including failures while consuming an RPC stream. */
export function observeConnectionError(error: unknown) {
  if (!Schema.is(RpcClientError.RpcClientError)(error)) return;

  const reason = error.reason;

  if (
    reason._tag === 'HttpError' &&
    reason.kind !== 'EncodeError' &&
    reason.kind !== 'InvalidUrlError'
  )
    serverConnection.disconnected();
}
