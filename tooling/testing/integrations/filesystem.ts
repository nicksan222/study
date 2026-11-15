/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides Bun filesystem services for disposable integration fixtures.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Runs filesystem operations on isolated fixture paths.                                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers own cleanup of all temporary directories.                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Path } from 'effect';

export const fs = await Effect.runPromise(
  Effect.provide(FileSystem.FileSystem, BunFileSystem.layer)
);

export const path = await Effect.runPromise(Effect.provide(Path.Path, BunPath.layer));

export const run = Effect.runPromise;
