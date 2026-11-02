/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds system health, search, and worker lifecycle RPC operations to the system     │
 * │ service.                                                                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - RPC handlers adapt declared schemas to the owning feature service; transport wiring    │
 * │   stays here.                                                                            │
 * │ - Maps declared operations to the feature service.                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Leaves input validation and domain behavior to contracts and service.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { SystemRpc } from '@study/contracts/system/rpc';
import { Effect } from 'effect';

import { System } from '#server/features/system/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const SystemRpcLive = defineRpc(
  SystemRpc,
  Effect.gen(function* () {
    const system = yield* System;

    return {
      'system.createBackup': () => system.createBackup(),
      'system.listBackups': () => system.backups(),
      'system.readBackup': (input) => system.readBackup(input),
      'system.importBackup': (input) => system.importBackup(input),
      'system.deleteBackup': (input) => system.deleteBackup(input),
      'system.previewRestore': (input) => system.previewRestore(input),
      'system.acceptRestore': (input) => system.acceptRestore(input),
      'system.restoreStatus': () => system.restoreStatus(),
      'system.discardRestoreRecovery': () => system.discardRestoreRecovery(),
      'system.health': () => system.health(),
      'system.materialSearch': (input) => system.materialSearch(input),
      'system.search': (input) => system.search(input),
      'system.startWorkers': () => system.startWorkers(),
      'system.stopWorkers': () => system.stopWorkers()
    };
  })
);
