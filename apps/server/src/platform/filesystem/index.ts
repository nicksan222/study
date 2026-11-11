/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Bridges Effect filesystem services to asynchronous Bun resource adapters.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Executes scoped filesystem operations at the Bun platform boundary.                    │
 * │ - Acquires native and POSIX path services for filesystem consumers.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only filesystem resource adapters should execute Effects through this bridge.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Path } from 'effect';

export function runFileSystemPromise<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

function runFileSystemSync<A, E>(effect: Effect.Effect<A, E>): A {
  return Effect.runSync(effect);
}

export const fileSystem = runFileSystemPromise(
  Effect.provide(FileSystem.FileSystem, BunFileSystem.layer)
);

export const nativePaths = runFileSystemSync(Effect.provide(Path.Path, BunPath.layer));

export const posixPaths = runFileSystemSync(Effect.provide(Path.Path, BunPath.layerPosix));
