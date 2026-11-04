/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes native Materials RPC handlers with real deletion participants for tests.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Supplies the same public synchronous participant set as the native runtime.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Fixtures still provide their own services and SQLite context; no handler is mocked.      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Layer } from 'effect';

import { Learning } from '#server/features/learning/index';
import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';

export const materialRpcHandlers = MaterialsRpcLive.pipe(
  Layer.provide(Materials.deletionParticipantsLayer({ Learning }))
);
