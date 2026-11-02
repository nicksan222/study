import type {
  BackupId,
  BackupManifest,
  RestorePreview,
  acceptRestoreSchema,
  restoreStatusSchema
} from '@study/contracts/system/backups';
import { MAX_MANAGED_BACKUPS } from '@study/contracts/system/backups';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';

import * as api from './data.queries';
import { downloadBackup, encodeBackupFile } from './files';

type Status = typeof restoreStatusSchema.Type;
type Submission = {
  kind: 'create' | 'import' | 'delete' | 'accept' | 'discard';
  id?: BackupId;
  acceptance?: typeof acceptRestoreSchema.Type;
  fileName?: string;
};
type State = {
  busy: boolean;
  loaded: boolean;
  statusReady: boolean;
  listReady: boolean;
  error?: 'read' | 'file';
  uncertain?: Submission;
  submitted?: Submission;
  receipt?: BackupManifest | Status | { completed: true };
  backups: readonly BackupManifest[];
  status?: Status;
  preview?: RestorePreview;
  reconciled: boolean;
};
const owners = new WeakMap<QueryClient, DataOwner>();

export class DataOwner {
  state: State = {
    busy: false,
    loaded: false,
    statusReady: false,
    listReady: false,
    backups: [],
    reconciled: false
  };
  private listeners = new Set<() => void>();
  constructor(private client: QueryClient) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private lock() {
    if (this.state.busy) return false;
    this.update({
      busy: true,
      error: this.state.listReady && this.state.statusReady ? undefined : this.state.error
    });
    return true;
  }
  private mutable() {
    return (
      this.state.listReady &&
      this.state.statusReady &&
      !this.state.error &&
      !this.state.uncertain &&
      this.state.status?.state !== 'restart-required'
    );
  }
  private canDiscard() {
    return (
      this.state.statusReady &&
      !this.state.uncertain &&
      this.state.status !== undefined &&
      this.state.status.state !== 'restart-required' &&
      (this.state.status.recoveryCopy || this.state.status.state !== 'idle')
    );
  }
  refresh = async () => {
    if (!this.lock()) return;
    this.update({
      preview: undefined,
      error: undefined,
      statusReady: false,
      listReady: false,
      reconciled: false
    });
    try {
      // Status discovery must survive a corrupt or unreadable managed artifact list.
      const status = await this.client.fetchQuery(api.restoreStatusQueryOptions());
      this.update({
        status,
        statusReady: true,
        reconciled: this.state.uncertain?.kind === 'discard'
      });
      const backups = await this.client.fetchQuery(api.backupsQueryOptions());
      this.update({ backups, loaded: true, listReady: true, reconciled: true });
    } catch {
      this.update({ error: 'read' });
    } finally {
      this.update({ busy: false });
    }
  };
  acknowledgeUncertain = () => {
    if (!this.state.busy && this.state.reconciled)
      this.update({ uncertain: undefined, submitted: undefined, receipt: undefined });
  };
  private async mutate<A>(submission: Submission, run: () => Promise<A>) {
    const permitted = submission.kind === 'discard' ? this.canDiscard() : this.mutable();
    if (!permitted || !this.lock()) return;
    this.update({
      submitted: submission,
      receipt: undefined,
      preview: undefined,
      reconciled: false
    });
    try {
      const receipt = await run();
      this.update({ receipt: (receipt ?? { completed: true }) as State['receipt'] });
    } catch {
      this.update({ uncertain: submission });
    } finally {
      this.update({ busy: false });
    }
    await this.refresh();
  }
  create = () => {
    if (this.state.backups.length >= MAX_MANAGED_BACKUPS) return;
    return this.mutate({ kind: 'create' }, () =>
      this.client
        .getMutationCache()
        .build(this.client, api.createBackupOptions())
        .execute(undefined)
    );
  };
  importFile = async (file: File) => {
    if (!this.mutable() || this.state.backups.length >= MAX_MANAGED_BACKUPS || !this.lock()) return;
    let bytes: string;
    try {
      bytes = await encodeBackupFile(file);
    } catch {
      this.update({ busy: false, error: 'file' });
      return;
    }
    this.update({ busy: false });
    return this.mutate({ kind: 'import', fileName: file.name }, () =>
      this.client.getMutationCache().build(this.client, api.importBackupOptions()).execute(bytes)
    );
  };
  delete = (id: BackupId) =>
    this.mutate({ kind: 'delete', id }, () =>
      this.client.getMutationCache().build(this.client, api.deleteBackupOptions()).execute(id)
    );
  discard = () =>
    this.mutate({ kind: 'discard' }, () =>
      this.client
        .getMutationCache()
        .build(this.client, api.discardRecoveryOptions())
        .execute(undefined)
    );
  preview = async (id: BackupId) => {
    if (!this.mutable() || !this.lock()) return;
    this.update({ preview: undefined });
    try {
      this.update({
        preview: await this.client.fetchQuery({ ...api.previewRestoreOptions(id), staleTime: 0 })
      });
    } catch {
      this.update({ error: 'read' });
    } finally {
      this.update({ busy: false });
    }
  };
  clearPreview = () => {
    if (!this.state.busy) this.update({ preview: undefined });
  };
  accept = (expected: RestorePreview) => {
    if (
      this.state.preview !== expected ||
      expected.blockedByCurrentBarriers ||
      this.state.status?.recoveryCopy
    )
      return;
    const acceptance: typeof acceptRestoreSchema.Type = {
      token: expected.token,
      backupId: expected.backup.id,
      sha256: expected.backup.sha256,
      target: expected.target,
      acknowledgeReplacement: true
    };
    return this.mutate({ kind: 'accept', id: expected.backup.id, acceptance }, () =>
      this.client
        .getMutationCache()
        .build(this.client, api.acceptRestoreOptions())
        .execute(acceptance)
    );
  };
  download = async (id: BackupId) => {
    if (this.state.uncertain || !this.lock()) return;
    try {
      downloadBackup(await this.client.fetchQuery(api.readBackupOptions(id)), id);
    } catch {
      this.update({ error: 'read' });
    } finally {
      this.client.removeQueries({ queryKey: api.readBackupOptions(id).queryKey });
      this.update({ busy: false });
    }
  };
}
export function dataOwner(client: QueryClient) {
  let owner = owners.get(client);
  if (!owner) {
    owner = new DataOwner(client);
    owners.set(client, owner);
  }
  return owner;
}
export function useDataSettings() {
  const owner = dataOwner(useQueryClient());
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  useEffect(() => {
    void owner.refresh();
  }, [owner]);
  return { state, owner };
}
