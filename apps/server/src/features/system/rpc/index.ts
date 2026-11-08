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

import { System } from '#server/features/system/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const SystemRpcLive = defineRpc(SystemRpc, { system: System }, ({ system }) => ({
  'system.createBackup': () => system.createBackup(),
  'system.listBackups': () => system.backups(),
  'system.readBackup': system.readBackup,
  'system.importBackup': system.importBackup,
  'system.deleteBackup': system.deleteBackup,
  'system.previewRestore': system.previewRestore,
  'system.acceptRestore': system.acceptRestore,
  'system.restoreStatus': () => system.restoreStatus(),
  'system.discardRestoreRecovery': () => system.discardRestoreRecovery(),
  'system.health': () => system.health(),
  'system.materialSearch': system.materialSearch,
  'system.search': system.search,
  'system.startWorkers': () => system.startWorkers(),
  'system.stopWorkers': () => system.stopWorkers()
}));
