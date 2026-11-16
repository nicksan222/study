import { RegistryContext } from '@effect/atom-react';
import { backupIdSchema, restoreTokenSchema } from '@study/contracts';
import type { BackupManifest, RestorePreview, restoreStatusSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import type { ReactNode } from 'react';

import type * as __StudyMockType0 from '#client/pages/settings/data/files.ts';
import type * as __StudyMockType1 from '#client/pages/settings/data/use-data.ts';

import type * as MockModule0 from './files';

function createRpc(mock: test.Mock) {
  return {
    list: mock.fn(),
    status: mock.fn(),
    create: mock.fn(),
    import: mock.fn(),
    delete: mock.fn(),
    preview: mock.fn(),
    accept: mock.fn(),
    discard: mock.fn(),
    read: mock.fn()
  };
}

let rpc: ReturnType<typeof createRpc>;

let downloadBackup: typeof __StudyMockType0.downloadBackup;

let dataOwner: typeof __StudyMockType1.dataOwner;

let useDataSettings: typeof __StudyMockType1.useDataSettings;

test.beforeEach(async ({ mock }) => {
  rpc = createRpc(mock);
  mock('#client/pages/settings/data/files.ts', async (load) => ({
    ...(await load<typeof MockModule0>()),
    downloadBackup: mock.fn()
  }));
  mock('@study/contracts/react', () => ({
    rpc: {
      system: {
        listBackups: { read: rpc.list },
        restoreStatus: { read: rpc.status },
        createBackup: { call: rpc.create },
        importBackup: { call: rpc.import },
        deleteBackup: { call: rpc.delete },
        previewRestore: { call: rpc.preview },
        acceptRestore: { call: rpc.accept },
        discardRestoreRecovery: { call: rpc.discard },
        readBackup: { read: rpc.read }
      }
    }
  }));
  const __studyMockModule0 = await import('./files');

  downloadBackup = __studyMockModule0.downloadBackup;
  const __studyMockModule1 = await import('./use-data');

  dataOwner = __studyMockModule1.dataOwner;
  useDataSettings = __studyMockModule1.useDataSettings;
});

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
  version: 2,
  createdAtMs: 1,
  schema: 'a'.repeat(64),
  sha256: 'b'.repeat(64),
  bytes: 100,
  scope,
  credentials: 'excluded',
  nativeWork: 'preserved',
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
  return AtomRegistry.make();
}

test.beforeEach(() => {
  Object.values(rpc).forEach((mock) => mock.mockReset());
  test.vi.mocked(downloadBackup).mockReset();
  rpc.list.mockResolvedValue([backup]);
  rpc.status.mockResolvedValue(idle);
  rpc.create.mockResolvedValue(backup);
  rpc.preview.mockResolvedValue(preview);
});

test.stable(
  'exposes read failure separately, and reconciles canonical discovery on reopen',
  async () => {
    const owner = dataOwner(client());

    rpc.list.mockRejectedValueOnce(new Error('offline'));
    await owner.refresh();
    test.expect(owner.state.error).toBe('read');
    test.expect(owner.state.uncertain).toBeUndefined();
    await owner.create();
    test.expect(rpc.create).not.toHaveBeenCalled();
    rpc.status.mockResolvedValue({ state: 'activation-failed', backupId: id, recoveryCopy: true });
    await owner.refresh();
    test.expect(owner.state.status?.state).toBe('activation-failed');
    test.expect(owner.state.status?.recoveryCopy).toBe(true);
  }
);

test.stable('synchronously excludes duplicate actions across section remounts', async () => {
  const shared = client();
  let finish!: (value: BackupManifest) => void;

  rpc.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RegistryContext.Provider value={shared}>{children}</RegistryContext.Provider>
  );
  const first = test.renderHook(useDataSettings, { wrapper });

  await test.waitFor(() => test.expect(first.result.current.state.loaded).toBe(true));
  test.act(() => {
    void first.result.current.owner.create();
    void first.result.current.owner.create();
  });
  first.unmount();
  const second = test.renderHook(useDataSettings, { wrapper });

  test.expect(second.result.current.state.busy).toBe(true);
  test.act(() => {
    void second.result.current.owner.create();
  });
  await test.waitFor(() => test.expect(rpc.create).toHaveBeenCalledTimes(1));
  await test.act(async () => {
    finish(backup);
  });
  await test.waitFor(() => test.expect(second.result.current.state.receipt).toEqual(backup));
});

test.stable(
  'retains ambiguous submitted identity, does not retry, and requires explicit reviewed reconciliation',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    rpc.delete.mockRejectedValue(new Error('connection lost'));
    await owner.delete(id);
    test.expect(owner.state.uncertain).toEqual({ kind: 'delete', id });
    await owner.delete(id);
    test.expect(rpc.delete).toHaveBeenCalledTimes(1);
    test.expect(owner.state.reconciled).toBe(true);
    owner.acknowledgeUncertain();
    test.expect(owner.state.uncertain).toBeUndefined();
  }
);

test.stable(
  'retains a known receipt if subsequent discovery fails without calling it uncertain',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    rpc.list.mockRejectedValue(new Error('offline'));
    await owner.create();
    test.expect(owner.state.receipt).toEqual(backup);
    test.expect(owner.state.error).toBe('read');
    test.expect(owner.state.uncertain).toBeUndefined();
  }
);

test.stable(
  'rejects changed and blocked previews and submits only the exact reviewed acceptance',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    await owner.preview(id);
    const old = owner.state.preview!;

    await owner.accept({ ...old });
    test.expect(rpc.accept).not.toHaveBeenCalled();
    rpc.preview.mockResolvedValue({
      ...preview,
      token: Schema.decodeUnknownSync(restoreTokenSchema)('22222222-2222-4222-8222-222222222222')
    });
    await owner.preview(id);
    await owner.accept(old);
    test.expect(rpc.accept).not.toHaveBeenCalled();
    rpc.preview.mockResolvedValue({ ...preview, blockedByCurrentBarriers: true });
    await owner.preview(id);
    await owner.accept(owner.state.preview!);
    test.expect(rpc.accept).not.toHaveBeenCalled();
    rpc.preview.mockResolvedValue(preview);
    await owner.preview(id);
    const status = { state: 'restart-required', backupId: id, recoveryCopy: false };

    rpc.accept.mockResolvedValue(status);
    rpc.status.mockResolvedValue(status);
    await owner.accept(owner.state.preview!);
    test.expect(rpc.accept).toHaveBeenCalledWith({
      token: preview.token,
      backupId: id,
      sha256: backup.sha256,
      target: preview.target,
      acknowledgeReplacement: true
    });
    await owner.create();
    test.expect(rpc.create).not.toHaveBeenCalled();
  }
);

test.stable(
  'blocks acceptance with a retained recovery copy and invalidates previews after reconciliation',
  async () => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ ...idle, recoveryCopy: true });
    await owner.refresh();
    await owner.preview(id);
    await owner.accept(owner.state.preview!);
    test.expect(rpc.accept).not.toHaveBeenCalled();
    await owner.refresh();
    test.expect(owner.state.preview).toBeUndefined();
  }
);

test.stable('does not treat failed downloads as uncertain mutations', async () => {
  const shared = client();
  const owner = dataOwner(shared);

  await owner.refresh();
  rpc.read.mockRejectedValue(new Error('offline'));
  await owner.download(id);
  test.expect(owner.state.error).toBe('read');
  test.expect(owner.state.uncertain).toBeUndefined();
});

test.stable('enforces managed capacity without counting external downloads', async () => {
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
  const arrayBuffer = test.vi.fn();

  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer });
  await owner.importFile(file);
  test.expect(rpc.create).not.toHaveBeenCalled();
  test.expect(rpc.import).not.toHaveBeenCalled();
  test.expect(arrayBuffer).not.toHaveBeenCalled();
});

test.stable(
  'retains an ambiguous import separately from file validation and never resubmits it on reopen',
  async () => {
    const shared = client();
    const owner = dataOwner(shared);

    await owner.refresh();
    await owner.importFile(new File([], 'empty.studybackup'));
    test.expect(owner.state.error).toBe('file');
    test.expect(owner.state.uncertain).toBeUndefined();
    await owner.refresh();
    const bytes = new TextEncoder().encode('STUDYBK1\nexample');

    rpc.import.mockRejectedValue(new Error('connection lost'));
    const file = new File([bytes], 'submitted.studybackup');

    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
    await owner.importFile(file);
    test
      .expect(owner.state.submitted)
      .toEqual({ kind: 'import', fileName: 'submitted.studybackup' });
    test.expect(owner.state.uncertain).toEqual(owner.state.submitted);
    await dataOwner(shared).refresh();
    test.expect(rpc.import).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'discovers canonical restart-required status even when the managed list cannot load',
  async () => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ state: 'restart-required', backupId: id, recoveryCopy: false });
    rpc.list.mockRejectedValue(new Error('corrupt artifact'));
    await owner.refresh();
    test.expect(owner.state.status?.state).toBe('restart-required');
    test.expect(owner.state.error).toBe('read');
    await owner.create();
    test.expect(rpc.create).not.toHaveBeenCalled();
  }
);

test.stable(
  'downloads a known snapshot after list failure without unlocking list-dependent writes',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    rpc.list.mockRejectedValue(new Error('corrupt unrelated artifact'));
    await owner.refresh();
    test.expect(owner.state.statusReady).toBe(true);
    test.expect(owner.state.listReady).toBe(false);
    rpc.read.mockResolvedValue('U1RVRFlCSzEK');
    await owner.download(id);
    test.expect(rpc.read).toHaveBeenCalledWith({ id });
    test.expect(downloadBackup).toHaveBeenCalledWith('U1RVRFlCSzEK', id);
    test.expect(owner.state.error).toBe('read');
    await owner.create();
    await owner.preview(id);
    test.expect(rpc.create).not.toHaveBeenCalled();
    test.expect(rpc.preview).not.toHaveBeenCalled();
  }
);

test.stable(
  'allows explicit recovery discard with fresh status even when no list has ever loaded',
  async () => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ state: 'activation-failed', backupId: id, recoveryCopy: true });
    rpc.list.mockRejectedValue(new Error('corrupt artifact'));
    await owner.refresh();
    test.expect(owner.state.loaded).toBe(false);
    rpc.discard.mockResolvedValue(undefined);
    await owner.discard();
    test.expect(rpc.discard).toHaveBeenCalledOnce();
    test.expect(owner.state.receipt).toEqual({ completed: true });
    test.expect(owner.state.uncertain).toBeUndefined();
  }
);

test.stable.each(['restart-required', 'failed-status-read'])(
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
    test.expect(rpc.discard).not.toHaveBeenCalled();
  }
);

test.stable(
  'requires explicit acknowledgment after an uncertain discard and successful independent status discovery',
  async () => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ state: 'activation-failed', backupId: id, recoveryCopy: true });
    rpc.list.mockRejectedValue(new Error('corrupt artifact'));
    await owner.refresh();
    rpc.discard.mockRejectedValue(new Error('connection lost'));
    await owner.discard();
    test.expect(owner.state.uncertain?.kind).toBe('discard');
    test.expect(owner.state.reconciled).toBe(true);
    await owner.discard();
    await owner.download(id);
    test.expect(rpc.discard).toHaveBeenCalledOnce();
    test.expect(rpc.read).not.toHaveBeenCalled();
    owner.acknowledgeUncertain();
    test.expect(owner.state.uncertain).toBeUndefined();
    await owner.create();
    test.expect(rpc.create).not.toHaveBeenCalled();
  }
);

test.stable.each(['delete', 'discard'] as const)(
  'does not acknowledge uncertain %s after a later failed discovery',
  async (kind) => {
    const owner = dataOwner(client());

    rpc.status.mockResolvedValue({ state: 'activation-failed', backupId: id, recoveryCopy: true });
    await owner.refresh();
    rpc[kind].mockRejectedValue(new Error('lost receipt'));

    if (kind === 'delete') await owner.delete(id);
    else await owner.discard();

    test.expect(owner.state.reconciled).toBe(true);
    rpc.status.mockRejectedValue(new Error('persistent status failure'));
    await owner.refresh();
    owner.acknowledgeUncertain();
    test.expect(owner.state.reconciled).toBe(false);
    test.expect(owner.state.uncertain?.kind).toBe(kind);
    await owner.download(id);
    await owner.discard();
    test.expect(rpc.read).not.toHaveBeenCalled();
    test.expect(rpc[kind]).toHaveBeenCalledOnce();
  }
);

test.stable(
  'does not reconcile an uncertain delete using status alone when list discovery fails',
  async () => {
    const owner = dataOwner(client());

    await owner.refresh();
    rpc.delete.mockRejectedValue(new Error('lost receipt'));
    rpc.list.mockRejectedValue(new Error('persistent corrupt artifact'));
    await owner.delete(id);
    test.expect(owner.state.statusReady).toBe(true);
    test.expect(owner.state.listReady).toBe(false);
    owner.acknowledgeUncertain();
    test.expect(owner.state.uncertain).toEqual({ kind: 'delete', id });
    await owner.refresh();
    owner.acknowledgeUncertain();
    test.expect(owner.state.uncertain).toEqual({ kind: 'delete', id });
    test.expect(rpc.delete).toHaveBeenCalledOnce();
  }
);

test.stable(
  'keeps the shared owner locked during file reads and late import completion after remount',
  async () => {
    const shared = client();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RegistryContext.Provider value={shared}>{children}</RegistryContext.Provider>
    );
    const first = test.renderHook(useDataSettings, { wrapper });

    await test.waitFor(() => test.expect(first.result.current.state.listReady).toBe(true));
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

    test.act(() => {
      pending = first.result.current.owner.importFile(file);
    });
    first.unmount();
    const second = test.renderHook(useDataSettings, { wrapper });

    test.expect(second.result.current.state.busy).toBe(true);
    await test.act(async () => {
      await second.result.current.owner.create();
      await second.result.current.owner.preview(id);
      await second.result.current.owner.download(id);
      await second.result.current.owner.discard();
    });
    test.expect(rpc.create).not.toHaveBeenCalled();
    test.expect(rpc.preview).not.toHaveBeenCalled();
    test.expect(rpc.read).not.toHaveBeenCalled();
    test.expect(rpc.discard).not.toHaveBeenCalled();
    test.expect(rpc.status).toHaveBeenCalledOnce();
    await test.act(async () => {
      finishRead(new TextEncoder().encode('STUDYBK1\nexample').buffer);
    });
    await test.waitFor(() => test.expect(rpc.import).toHaveBeenCalledOnce());
    test.expect(second.result.current.state.busy).toBe(true);
    await test.act(async () => {
      finishImport(backup);
      await pending;
    });
    test.expect(second.result.current.state.receipt).toEqual(backup);
    test.expect(second.result.current.state.busy).toBe(false);
    test.expect(second.result.current.state.listReady).toBe(true);
    test.expect(rpc.import).toHaveBeenCalledWith({ bytes: btoa('STUDYBK1\nexample') });
    test.expect(rpc.status).toHaveBeenCalledTimes(2);
    second.unmount();
  }
);

test.stable(
  'serializes exact-ID download against discovery without retaining byte payloads in owner state',
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
    test.expect(owner.state.busy).toBe(true);
    test.expect(rpc.status).toHaveBeenCalledOnce();
    test.expect(rpc.create).not.toHaveBeenCalled();
    await test.waitFor(() => test.expect(rpc.read).toHaveBeenCalledOnce());
    finish('U1RVRFlCSzEK');
    await pending;
    test.expect(downloadBackup).toHaveBeenCalledWith('U1RVRFlCSzEK', id);
    test.expect(owner.state.busy).toBe(false);
  }
);
