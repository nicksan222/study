import { acceptRestoreSchema, backupManifestSchema } from '@study/contracts/system/backups';
import { toastManager } from '@study/ui/toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { Schema } from 'effect';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { backupMutationKeys } from './data.queries';
import { BackupNotifications } from './notifications';

vi.mock('../../../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const backup = Schema.decodeUnknownSync(backupManifestSchema)({
  id: '11111111-1111-4111-8111-111111111111',
  format: 'study-managed-backup',
  version: 1,
  createdAtMs: 1,
  bytes: 1024,
  schema: 'a'.repeat(64),
  sha256: 'b'.repeat(64),
  credentials: 'excluded',
  nativeWork: 'retired',
  compatibility: 'exact-schema',
  scope: {
    materials: 1,
    versions: 1,
    documents: 1,
    sources: 1,
    collections: 1,
    sessions: 1,
    annotations: 0,
    quizAttempts: 0,
    cardReviews: 0,
    practiceSlots: 0,
    tombstones: 0,
    historyPrunes: 0,
    prunedVersions: 0
  }
});

const acceptance = Schema.decodeUnknownSync(acceptRestoreSchema)({
  backupId: backup.id,
  token: backup.id,
  sha256: backup.sha256,
  target: 'c'.repeat(64),
  acknowledgeReplacement: true
});

beforeEach(() => {
  vi.spyOn(toastManager, 'add').mockReturnValue('toast-id');
});

function mount(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <BackupNotifications />
    </QueryClientProvider>
  );
}

async function complete(
  client: QueryClient,
  key: readonly unknown[],
  data: unknown,
  variables?: unknown
) {
  const mutation = client.getMutationCache().build<unknown, Error, unknown, unknown>(client, {
    mutationKey: key,
    mutationFn: async () => data,
    gcTime: Infinity
  });

  await act(async () => {
    await mutation.execute(variables);
  });
}

it('toasts a newly committed operation once and never replays cached success on remount or refresh', async () => {
  const client = new QueryClient();
  const first = mount(client);

  await complete(client, backupMutationKeys.create, backup);
  expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
    title: 'DataBackupCreated',
    type: 'success'
  });
  await client.invalidateQueries();
  first.unmount();
  const second = mount(client);

  expect(toastManager.add).toHaveBeenCalledTimes(1);
  second.unmount();
  client.clear();
});

it('does not notify about success that completed before the provider subscribed', async () => {
  const client = new QueryClient();

  await complete(client, backupMutationKeys.create, backup);
  const view = mount(client);

  expect(toastManager.add).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});

it.each(['idle', 'applied', 'activation-failed', 'target-changed', 'pending', 'uncertain'])(
  'does not call a fulfilled %s restore outcome a successful staged restore',
  async (state) => {
    const client = new QueryClient();
    const view = mount(client);

    await complete(
      client,
      backupMutationKeys.accept,
      { state, backupId: backup.id, recoveryCopy: false },
      acceptance
    );
    expect(toastManager.add).not.toHaveBeenCalled();
    view.unmount();
    client.clear();
  }
);

it('only confirms a staged restore for the exact accepted backup', async () => {
  const client = new QueryClient();
  const view = mount(client);

  await complete(
    client,
    backupMutationKeys.accept,
    {
      state: 'restart-required',
      backupId: '22222222-2222-4222-8222-222222222222',
      recoveryCopy: false
    },
    acceptance
  );
  expect(toastManager.add).not.toHaveBeenCalled();
  await complete(
    client,
    backupMutationKeys.accept,
    {
      state: 'restart-required',
      backupId: backup.id,
      recoveryCopy: false
    },
    acceptance
  );
  expect(toastManager.add).toHaveBeenCalledExactlyOnceWith({
    title: 'DataRestoreStaged',
    type: 'success'
  });
  view.unmount();
  client.clear();
});

it.each(
  [
    backupMutationKeys.create,
    backupMutationKeys.import,
    backupMutationKeys.delete,
    backupMutationKeys.discard
  ].map((key) => ({ key }))
)('does not turn a noncanonical fulfilled receipt into success for %s', async ({ key }) => {
  const client = new QueryClient();
  const view = mount(client);

  await complete(client, key, { state: 'failed' });
  expect(toastManager.add).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});

it('does not turn a rejected request into successful feedback', async () => {
  const client = new QueryClient();
  const view = mount(client);
  const mutation = client.getMutationCache().build(client, {
    mutationKey: backupMutationKeys.create,
    mutationFn: async () => {
      throw new Error('Receipt lost');
    }
  });

  await act(async () => {
    await expect(mutation.execute(undefined)).rejects.toThrow('Receipt lost');
  });
  expect(toastManager.add).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});
