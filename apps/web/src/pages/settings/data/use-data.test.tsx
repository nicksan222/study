import { backupIdSchema, restoreTokenSchema } from '@study/contracts/system/backups';
import type {
  BackupManifest,
  RestorePreview,
  restoreStatusSchema
} from '@study/contracts/system/backups';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import type { ReactNode } from 'react';
import { beforeEach, expect, vi } from 'vite-plus/test';

import type * as MockModule0 from './files';
import { downloadBackup } from './files';
import { dataOwner, useDataSettings } from './use-data';

vi.mock('./files', async (load) => ({
  ...(await load<typeof MockModule0>()),
  downloadBackup: vi.fn()
}));

const rpc = vi.hoisted(() => ({
  list: vi.fn(),
  status: vi.fn(),
  create: vi.fn(),
  import: vi.fn(),
  delete: vi.fn(),
  preview: vi.fn(),
  accept: vi.fn(),
  discard: vi.fn(),
  read: vi.fn()
}));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: unknown) => unknown) =>
    invoke({
      'system.listBackups': rpc.list,
      'system.restoreStatus': rpc.status,
      'system.createBackup': rpc.create,
      'system.importBackup': rpc.import,
      'system.deleteBackup': rpc.delete,
      'system.previewRestore': rpc.preview,
      'system.acceptRestore': rpc.accept,
      'system.discardRestoreRecovery': rpc.discard,
      'system.readBackup': rpc.read
    })
}));

const id = Schema.decodeUnknownSync(backupIdSchema)('11111111-1111-4111-8111-111111111111');

const scope = {
  materials: 1,
  versions: 2,
  pages: 3,
  pageVersions: 4,
  extractions: 2,
  pageRetirements: 0,
  sources: 4,
  collections: 5,
  notes: 6,
  annotations: 7,
  quizAttempts: 8,
  cardReviews: 9,
  practiceSlots: 10,
  tombstones: 0,
  historyPrunes: 0,
  prunedVersions: 0
};

const backup: BackupManifest = {
  id,
  format: 'study-managed-backup',
  version: 1,
  createdAtMs: 1,
  schema: 'a'.repeat(64),
  sha256: 'b'.repeat(64),
  bytes: 100,
  scope,
  credentials: 'excluded',
  nativeWork: 'retired',
  compatibility: 'exact-schema'
};

const preview: RestorePreview = {
  token: Schema.decodeUnknownSync(restoreTokenSchema)(id),
  backup,
  current: scope,
  target: 'c'.repeat(64),
  requiresRestart: true,
  requiresSignIn: true,
  replacesAllContent: true,
  backupRetainsDeletedContent: true,
  blockedByCurrentBarriers: false
};

const idle: typeof restoreStatusSchema.Type = {
  state: 'idle',
  backupId: null,
  recoveryCopy: false
};

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
}

beforeEach(() => {
  Object.values(rpc).forEach((mock) => mock.mockReset());
  vi.mocked(downloadBackup).mockReset();
  rpc.list.mockResolvedValue([backup]);
  rpc.status.mockResolvedValue(idle);
  rpc.create.mockResolvedValue(backup);
  rpc.preview.mockResolvedValue(preview);
});

testStable(
  'exposes read failure separately, and reconciles canonical discovery on reopen',
  async () => {
    const owner = dataOwner(client());

    rpc.list.mockRejectedValueOnce(new Error('offline'));
    await owner.refresh();
    expect(owner.state.error).toBe('read');
    expect(owner.state.uncertain).toBeUndefined();
    await owner.create();
    expect(rpc.create).not.toHaveBeenCalled();
    rpc.status.mockResolvedValue({ state: 'activation-failed', backupId: id, recoveryCopy: true });
    await owner.refresh();
    expect(owner.state.status?.state).toBe('activation-failed');
    expect(owner.state.status?.recoveryCopy).toBe(true);
  }
);

testStable('synchronously excludes duplicate actions across section remounts', async () => {
  const shared = client();
  let finish!: (value: BackupManifest) => void;

  rpc.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={shared}>{children}</QueryClientProvider>
  );
  const first = renderHook(useDataSettings, { wrapper });

  await waitFor(() => expect(first.result.current.state.loaded).toBe(true));
  act(() => {
    void first.result.current.owner.create();
    void first.result.current.owner.create();
  });
  first.unmount();
  const second = renderHook(useDataSettings, { wrapper });

  expect(second.result.current.state.busy).toBe(true);
  act(() => {
    void second.result.current.owner.create();
  });
  await waitFor(() => expect(rpc.create).toHaveBeenCalledTimes(1));
  await act(async () => {
    finish(backup);
  });
  await waitFor(() => expect(second.result.current.state.receipt).toEqual(backup));
});

testStable(
  'retains ambiguous submitted identity, does not retry, and requires explicit reviewed reconciliation',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    rpc.delete.mockRejectedValue(new Error('connection lost'));
    await owner.delete(id);
    expect(owner.state.uncertain).toEqual({ kind: 'delete', id });
    await owner.delete(id);
    expect(rpc.delete).toHaveBeenCalledTimes(1);
    expect(owner.state.reconciled).toBe(true);
    owner.acknowledgeUncertain();
    expect(owner.state.uncertain).toBeUndefined();
  }
);

testStable(
  'retains a known receipt if subsequent discovery fails without calling it uncertain',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    rpc.list.mockRejectedValue(new Error('offline'));
    await owner.create();
    expect(owner.state.receipt).toEqual(backup);
    expect(owner.state.error).toBe('read');
    expect(owner.state.uncertain).toBeUndefined();
  }
);

testStable(
  'rejects changed and blocked previews and submits only the exact reviewed acceptance',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    await owner.preview(id);
    const old = owner.state.preview!;

    await owner.accept({ ...old });
    expect(rpc.accept).not.toHaveBeenCalled();
    rpc.preview.mockResolvedValue({
      ...preview,
      token: Schema.decodeUnknownSync(restoreTokenSchema)('22222222-2222-4222-8222-222222222222')
    });
    await owner.preview(id);
    await owner.accept(old);
    expect(rpc.accept).not.toHaveBeenCalled();
    rpc.preview.mockResolvedValue({ ...preview, blockedByCurrentBarriers: true });
    await owner.preview(id);
    await owner.accept(owner.state.preview!);
    expect(rpc.accept).not.toHaveBeenCalled();
    rpc.preview.mockResolvedValue(preview);
    await owner.preview(id);
    const status = { state: 'restart-required', backupId: id, recoveryCopy: false };

    rpc.accept.mockResolvedValue(status);
    rpc.status.mockResolvedValue(status);
    await owner.accept(owner.state.preview!);
    expect(rpc.accept).toHaveBeenCalledWith({
      token: preview.token,
      backupId: id,
      sha256: backup.sha256,
      target: preview.target,
      acknowledgeReplacement: true
    });
    await owner.create();
    expect(rpc.create).not.toHaveBeenCalled();
  }
);

testStable(
  'blocks acceptance with a retained recovery copy and invalidates previews after reconciliation',
  async () => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ ...idle, recoveryCopy: true });
    await owner.refresh();
    await owner.preview(id);
    await owner.accept(owner.state.preview!);
    expect(rpc.accept).not.toHaveBeenCalled();
    await owner.refresh();
    expect(owner.state.preview).toBeUndefined();
  }
);

testStable('does not treat failed downloads as uncertain mutations', async () => {
  const shared = client();
  const owner = dataOwner(shared);

  await owner.refresh();
  rpc.read.mockRejectedValue(new Error('offline'));
  await owner.download(id);
  expect(owner.state.error).toBe('read');
  expect(owner.state.uncertain).toBeUndefined();
  expect(shared.getQueryData(['settings-data', 'bytes', id])).toBeUndefined();
});

testStable('enforces managed capacity without counting external downloads', async () => {
  const owner = dataOwner(client());

  rpc.list.mockResolvedValue(
    Array.from({ length: 8 }, (_, index) => ({
      ...backup,
      id: Schema.decodeUnknownSync(backupIdSchema)(`11111111-1111-4111-8111-11111111111${index}`)
    }))
  );
  await owner.refresh();
  await owner.create();
  const file = new File(['STUDYBK1\nexample'], 'backup.studybackup');
  const arrayBuffer = vi.fn();

  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });
  await owner.importFile(file);
  expect(rpc.create).not.toHaveBeenCalled();
  expect(rpc.import).not.toHaveBeenCalled();
  expect(arrayBuffer).not.toHaveBeenCalled();
});

testStable(
  'retains an ambiguous import separately from file validation and never resubmits it on reopen',
  async () => {
    const shared = client();
    const owner = dataOwner(shared);

    await owner.refresh();
    await owner.importFile(new File([], 'empty.studybackup'));
    expect(owner.state.error).toBe('file');
    expect(owner.state.uncertain).toBeUndefined();
    await owner.refresh();
    const bytes = new TextEncoder().encode('STUDYBK1\nexample');

    rpc.import.mockRejectedValue(new Error('connection lost'));
    const file = new File([bytes], 'submitted.studybackup');

    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    await owner.importFile(file);
    expect(owner.state.submitted).toEqual({ kind: 'import', fileName: 'submitted.studybackup' });
    expect(owner.state.uncertain).toEqual(owner.state.submitted);
    await dataOwner(shared).refresh();
    expect(rpc.import).toHaveBeenCalledTimes(1);
  }
);

testStable(
  'discovers canonical restart-required status even when the managed list cannot load',
  async () => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ state: 'restart-required', backupId: id, recoveryCopy: false });
    rpc.list.mockRejectedValue(new Error('corrupt artifact'));
    await owner.refresh();
    expect(owner.state.status?.state).toBe('restart-required');
    expect(owner.state.error).toBe('read');
    await owner.create();
    expect(rpc.create).not.toHaveBeenCalled();
  }
);

testStable(
  'downloads a known snapshot after list failure without unlocking list-dependent writes',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    rpc.list.mockRejectedValue(new Error('corrupt unrelated artifact'));
    await owner.refresh();
    expect(owner.state.statusReady).toBe(true);
    expect(owner.state.listReady).toBe(false);
    rpc.read.mockResolvedValue('U1RVRFlCSzEK');
    await owner.download(id);
    expect(rpc.read).toHaveBeenCalledWith({ id });
    expect(downloadBackup).toHaveBeenCalledWith('U1RVRFlCSzEK', id);
    expect(owner.state.error).toBe('read');
    await owner.create();
    await owner.preview(id);
    expect(rpc.create).not.toHaveBeenCalled();
    expect(rpc.preview).not.toHaveBeenCalled();
  }
);

testStable(
  'allows explicit recovery discard with fresh status even when no list has ever loaded',
  async () => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ state: 'activation-failed', backupId: id, recoveryCopy: true });
    rpc.list.mockRejectedValue(new Error('corrupt artifact'));
    await owner.refresh();
    expect(owner.state.loaded).toBe(false);
    rpc.discard.mockResolvedValue(undefined);
    await owner.discard();
    expect(rpc.discard).toHaveBeenCalledOnce();
    expect(owner.state.receipt).toEqual({ completed: true });
    expect(owner.state.uncertain).toBeUndefined();
  }
);

testStable.each(['restart-required', 'failed-status-read'])(
  'keeps recovery discard locked for %s despite retained recovery information',
  async (mode) => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ state: 'activation-failed', backupId: id, recoveryCopy: true });
    await owner.refresh();

    if (mode === 'restart-required')
      rpc.status.mockResolvedValue({ state: 'restart-required', backupId: id, recoveryCopy: true });
    else rpc.status.mockRejectedValue(new Error('offline'));

    rpc.list.mockRejectedValue(new Error('corrupt artifact'));
    await owner.refresh();
    await owner.discard();
    expect(rpc.discard).not.toHaveBeenCalled();
  }
);

testStable(
  'requires explicit acknowledgment after an uncertain discard and successful independent status discovery',
  async () => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ state: 'activation-failed', backupId: id, recoveryCopy: true });
    rpc.list.mockRejectedValue(new Error('corrupt artifact'));
    await owner.refresh();
    rpc.discard.mockRejectedValue(new Error('connection lost'));
    await owner.discard();
    expect(owner.state.uncertain?.kind).toBe('discard');
    expect(owner.state.reconciled).toBe(true);
    await owner.discard();
    await owner.download(id);
    expect(rpc.discard).toHaveBeenCalledOnce();
    expect(rpc.read).not.toHaveBeenCalled();
    owner.acknowledgeUncertain();
    expect(owner.state.uncertain).toBeUndefined();
    await owner.create();
    expect(rpc.create).not.toHaveBeenCalled();
  }
);

testStable.each(['delete', 'discard'] as const)(
  'does not acknowledge uncertain %s after a later failed discovery',
  async (kind) => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ state: 'activation-failed', backupId: id, recoveryCopy: true });
    await owner.refresh();
    rpc[kind].mockRejectedValue(new Error('lost receipt'));

    if (kind === 'delete') await owner.delete(id);
    else await owner.discard();

    expect(owner.state.reconciled).toBe(true);
    rpc.status.mockRejectedValue(new Error('persistent status failure'));
    await owner.refresh();
    owner.acknowledgeUncertain();
    expect(owner.state.reconciled).toBe(false);
    expect(owner.state.uncertain?.kind).toBe(kind);
    await owner.download(id);
    await owner.discard();
    expect(rpc.read).not.toHaveBeenCalled();
    expect(rpc[kind]).toHaveBeenCalledOnce();
  }
);

testStable(
  'does not reconcile an uncertain delete using status alone when list discovery fails',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    rpc.delete.mockRejectedValue(new Error('lost receipt'));
    rpc.list.mockRejectedValue(new Error('persistent corrupt artifact'));
    await owner.delete(id);
    expect(owner.state.statusReady).toBe(true);
    expect(owner.state.listReady).toBe(false);
    owner.acknowledgeUncertain();
    expect(owner.state.uncertain).toEqual({ kind: 'delete', id });
    await owner.refresh();
    owner.acknowledgeUncertain();
    expect(owner.state.uncertain).toEqual({ kind: 'delete', id });
    expect(rpc.delete).toHaveBeenCalledOnce();
  }
);

testStable(
  'keeps the shared owner locked during file reads and late import completion after remount',
  async () => {
    const shared = client();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={shared}>{children}</QueryClientProvider>
    );
    const first = renderHook(useDataSettings, { wrapper });

    await waitFor(() => expect(first.result.current.state.listReady).toBe(true));
    let finishRead!: (bytes: ArrayBuffer) => void;
    const read = new Promise<ArrayBuffer>((resolve) => {
      finishRead = resolve;
    });
    let finishImport!: (receipt: BackupManifest) => void;

    rpc.import.mockImplementation(
      () =>
        new Promise<BackupManifest>((resolve) => {
          finishImport = resolve;
        })
    );
    const file = new File(['STUDYBK1\nexample'], 'late.studybackup');

    Object.defineProperty(file, 'arrayBuffer', { value: () => read });
    let pending!: Promise<void>;

    act(() => {
      pending = first.result.current.owner.importFile(file);
    });
    first.unmount();
    const second = renderHook(useDataSettings, { wrapper });

    expect(second.result.current.state.busy).toBe(true);
    await act(async () => {
      await second.result.current.owner.create();
      await second.result.current.owner.preview(id);
      await second.result.current.owner.download(id);
      await second.result.current.owner.discard();
    });
    expect(rpc.create).not.toHaveBeenCalled();
    expect(rpc.preview).not.toHaveBeenCalled();
    expect(rpc.read).not.toHaveBeenCalled();
    expect(rpc.discard).not.toHaveBeenCalled();
    expect(rpc.status).toHaveBeenCalledOnce();
    await act(async () => {
      finishRead(new TextEncoder().encode('STUDYBK1\nexample').buffer);
    });
    await waitFor(() => expect(rpc.import).toHaveBeenCalledOnce());
    expect(second.result.current.state.busy).toBe(true);
    await act(async () => {
      finishImport(backup);
      await pending;
    });
    expect(second.result.current.state.receipt).toEqual(backup);
    expect(second.result.current.state.busy).toBe(false);
    expect(second.result.current.state.listReady).toBe(true);
    expect(rpc.import).toHaveBeenCalledWith({ bytes: btoa('STUDYBK1\nexample') });
    expect(rpc.status).toHaveBeenCalledTimes(2);
    second.unmount();
  }
);

testStable(
  'serializes exact-ID download against discovery and clears successful byte transport from cache',
  async () => {
    const shared = client();
    const owner = dataOwner(shared);

    await owner.refresh();
    let finish!: (bytes: string) => void;

    rpc.read.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        })
    );
    const pending = owner.download(id);

    await owner.refresh();
    await owner.create();
    await owner.download(id);
    expect(owner.state.busy).toBe(true);
    expect(rpc.status).toHaveBeenCalledOnce();
    expect(rpc.create).not.toHaveBeenCalled();
    await waitFor(() => expect(rpc.read).toHaveBeenCalledOnce());
    finish('U1RVRFlCSzEK');
    await pending;
    expect(downloadBackup).toHaveBeenCalledWith('U1RVRFlCSzEK', id);
    expect(
      shared.getQueryCache().find({ queryKey: ['settings-data', 'bytes', id] })
    ).toBeUndefined();
    expect(owner.state.busy).toBe(false);
  }
);
