import type { Effect } from 'effect';
import { Layer, ManagedRuntime } from 'effect';

import type { nativeLayers } from './native.ts';

/** Application layers may acquire asynchronous resources; synchronous runners are not exposed. */
function asynchronousRuntime<R, E>(
  layer: Layer.Layer<R, E>
): Omit<ManagedRuntime.ManagedRuntime<R, E>, 'runSync' | 'runSyncExit'> {
  return ManagedRuntime.make(layer);
}

/** Runtime boundaries for the native HTTP and workflow lifetimes. */
export function createNativeRuntime(layers: ReturnType<typeof nativeLayers>) {
  return asynchronousRuntime(layers.services);
}

/** Worker restarts reuse application services and acquire a fresh engine scope. */
export function createWorkflowRuntime(
  layers: ReturnType<typeof nativeLayers>,
  application: ReturnType<typeof createNativeRuntime>
) {
  return asynchronousRuntime(
    layers.workflows.pipe(Layer.provideMerge(Layer.effectContext(application.contextEffect)))
  );
}

const nativeRunner = asynchronousRuntime(Layer.empty);

export function runNative<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return nativeRunner.runPromise(effect);
}
