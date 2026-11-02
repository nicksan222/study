import type { BackupId, acceptRestoreSchema } from '@study/contracts/system/backups';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { request } from '../../../lib/study-client/request';

export const restoreStatusQueryOptions = () =>
  queryOptions({
    queryKey: ['settings-data', 'restore-status'],
    retry: false,
    staleTime: 0,
    queryFn: () => request((c) => c['system.restoreStatus']({}))
  });
export const backupsQueryOptions = () =>
  queryOptions({
    queryKey: ['settings-data', 'backups'],
    retry: false,
    staleTime: 0,
    queryFn: () => request((c) => c['system.listBackups']({}))
  });
export const createBackupOptions = () =>
  mutationOptions({
    gcTime: 0,
    retry: false,
    mutationFn: () => request((c) => c['system.createBackup']({}))
  });
export const importBackupOptions = () =>
  mutationOptions({
    gcTime: 0,
    retry: false,
    mutationFn: (bytes: string) => request((c) => c['system.importBackup']({ bytes }))
  });
export const deleteBackupOptions = () =>
  mutationOptions({
    gcTime: 0,
    retry: false,
    mutationFn: (id: BackupId) => request((c) => c['system.deleteBackup']({ id }))
  });
export const readBackupOptions = (id: BackupId) =>
  queryOptions({
    queryKey: ['settings-data', 'bytes', id],
    retry: false,
    gcTime: 0,
    queryFn: () => request((c) => c['system.readBackup']({ id }))
  });
export const previewRestoreOptions = (id: BackupId) =>
  queryOptions({
    queryKey: ['settings-data', 'preview', id],
    retry: false,
    gcTime: 0,
    queryFn: () => request((c) => c['system.previewRestore']({ id }))
  });
export const acceptRestoreOptions = () =>
  mutationOptions({
    gcTime: 0,
    retry: false,
    mutationFn: (input: typeof acceptRestoreSchema.Type) =>
      request((c) => c['system.acceptRestore'](input))
  });
export const discardRecoveryOptions = () =>
  mutationOptions({
    gcTime: 0,
    retry: false,
    mutationFn: () => request((c) => c['system.discardRestoreRecovery']({}))
  });
