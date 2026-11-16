import { backupIdSchema, restoreTokenSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';

import type * as __StudyMockType0 from '#client/pages/settings/data/index.tsx';
import type * as __StudyMockType1 from '#client/pages/settings/data/use-data.ts';

import type * as MockModule0 from './use-data';

let DataSettings: typeof __StudyMockType0.DataSettings;

let dataOwner: typeof __StudyMockType1.dataOwner;

let useDataSettings: typeof __StudyMockType1.useDataSettings;

test.beforeEach(async ({ mock }) => {
  mock('#client/pages/settings/data/use-data.ts', async (load) => ({
    ...(await load<typeof MockModule0>()),
    useDataSettings: mock.fn()
  }));
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({
      t: (key: string) => key,
      locale: 'english',
      number: String,
      date: (seconds: number | bigint) => `date:${seconds}`
    })
  }));
  const __studyMockModule0 = await import('./index');

  DataSettings = __studyMockModule0.DataSettings;
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

const backup = {
  id,
  format: 'study-managed-backup' as const,
  version: 2 as const,
  createdAtMs: 1,
  schema: 'a'.repeat(64),
  sha256: 'b'.repeat(64),
  bytes: 100,
  scope,
  credentials: 'excluded' as const,
  nativeWork: 'preserved' as const,
  compatibility: 'exact-schema' as const
};

function model() {
  const owner = dataOwner(AtomRegistry.make());

  test.vi.spyOn(owner, 'refresh').mockResolvedValue(undefined);
  test.vi.spyOn(owner, 'create').mockResolvedValue(undefined);
  test.vi.spyOn(owner, 'importFile').mockResolvedValue(undefined);
  test.vi.spyOn(owner, 'download').mockResolvedValue(undefined);
  test.vi.spyOn(owner, 'preview').mockResolvedValue(undefined);
  test.vi.spyOn(owner, 'delete').mockResolvedValue(undefined);
  test.vi.spyOn(owner, 'discard').mockResolvedValue(undefined);
  test.vi.spyOn(owner, 'accept').mockResolvedValue(undefined);
  test.vi.spyOn(owner, 'clearPreview').mockImplementation(() => {});
  test.vi.spyOn(owner, 'acknowledgeUncertain').mockImplementation(() => {});
  const state: ReturnType<typeof useDataSettings>['state'] = {
    busy: false,
    loaded: true,
    statusReady: true,
    listReady: true,
    backups: [backup],
    reconciled: true,
    status: { state: 'idle' as const, backupId: null, recoveryCopy: false },
    preview: {
      token: Schema.decodeUnknownSync(restoreTokenSchema)(id),
      backup,
      current: scope,
      target: 'c'.repeat(64),
      requiresRestart: true as const,
      requiresSignIn: true as const,
      replacesAllContent: true as const,
      backupRetainsDeletedContent: true as const,
      blockedByCurrentBarriers: false
    }
  };

  return { state, owner };
}

function supply(value: ReturnType<typeof model>) {
  test.vi.mocked(useDataSettings).mockReturnValue(value);
}

test.beforeEach(() => test.vi.clearAllMocks());

test.stable(
  'shows complete scopes and requires deliberate acceptance of the exact reviewed backup',
  () => {
    const value = model();

    supply(value);
    test.render(<DataSettings />);
    test.expect(test.screen.getByText('DataRestoreWarning')).toBeInTheDocument();
    Object.keys(scope).forEach((key) =>
      test.expect(test.screen.getByText(`DataScope${key}`)).toBeInTheDocument()
    );
    test.expect(test.screen.queryByText(backup.schema)).toBeNull();
    const accept = test.screen.getByRole('button', { name: 'DataAccept' });

    test.expect(accept).toBeDisabled();
    test.fireEvent.change(
      test.screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }),
      {
        target: { value: 'DataRestoreConfirmationWord' }
      }
    );
    test.fireEvent.click(accept);
    test.expect(value.owner.accept).toHaveBeenCalledWith(value.state.preview);
  }
);

test.stable('resets deliberate intent when the preview token changes and blocks barriers', () => {
  const value = model();

  supply(value);
  const { rerender } = test.render(<DataSettings />);

  test.fireEvent.change(
    test.screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }),
    {
      target: { value: 'DataRestoreConfirmationWord' }
    }
  );
  value.state.preview = {
    ...value.state.preview!,
    token: Schema.decodeUnknownSync(restoreTokenSchema)('22222222-2222-4222-8222-222222222222')
  };
  supply(value);
  rerender(<DataSettings />);
  test.expect(test.screen.getByRole('button', { name: 'DataAccept' })).toBeDisabled();
  test
    .expect(test.screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }))
    .toHaveValue('');
  test.fireEvent.change(
    test.screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }),
    {
      target: { value: 'DataRestoreConfirmationWord' }
    }
  );
  test.expect(test.screen.getByRole('button', { name: 'DataAccept' })).toBeEnabled();
  value.state.preview = { ...value.state.preview!, blockedByCurrentBarriers: true };
  supply(value);
  rerender(<DataSettings />);
  test.expect(test.screen.getByText('DataBlocked')).toBeInTheDocument();
  test
    .expect(test.screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }))
    .toBeDisabled();
  test.expect(value.owner.accept).not.toHaveBeenCalled();
  value.state.preview = { ...value.state.preview!, blockedByCurrentBarriers: false };
  supply(value);
  rerender(<DataSettings />);
  test.fireEvent.click(test.screen.getByRole('button', { name: 'DataAccept' }));
  test.expect(value.owner.accept).toHaveBeenCalledWith(value.state.preview);
});

test.stable('requires deliberate recovery discard', () => {
  const value = model();

  value.state.preview = undefined;
  value.state.status = { ...value.state.status!, recoveryCopy: true };
  supply(value);
  test.render(<DataSettings />);
  test.expect(test.screen.getByText('DataRecovery')).toBeInTheDocument();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'DataDiscard' }));
  const buttons = test.screen.getAllByRole('button', { name: 'DataDiscard' });

  test.expect(buttons.at(-1)).toBeDisabled();
  test.fireEvent.change(
    test.screen.getByRole('textbox', { name: 'DeleteConfirmationInstruction' }),
    {
      target: { value: 'DeleteConfirmationWord' }
    }
  );
  test.fireEvent.click(buttons.at(-1)!);
  test.expect(value.owner.discard).toHaveBeenCalledOnce();
});

test.stable(
  'keeps implementation identities out while replacement scope and consent stay visible',
  () => {
    supply(model());
    test.render(<DataSettings />);
    test.expect(test.screen.queryByText(backup.schema)).toBeNull();
    test.expect(test.screen.queryByText(backup.sha256)).toBeNull();
    test.expect(test.screen.queryByText('workspace.details')).toBeNull();
    test.expect(test.screen.getByText('DataRestoreWarning')).toBeVisible();
    test.expect(test.screen.getByRole('table')).toBeVisible();
    test
      .expect(test.screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }))
      .toBeVisible();
    test.expect(test.screen.getByRole('button', { name: 'DataAccept' })).toBeDisabled();
  }
);

test.stable(
  'keeps known downloads and deliberate recovery available when only the list is unavailable',
  () => {
    const value = model();

    value.state.preview = undefined;
    value.state.listReady = false;
    value.state.error = 'read';
    value.state.status = { ...value.state.status!, recoveryCopy: true };
    supply(value);
    test.render(<DataSettings />);
    test.expect(test.screen.getByText('DataListError')).toBeVisible();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'DataDownload' }));
    test.expect(value.owner.download).toHaveBeenCalledWith(id);
    test
      .expect(
        test
          .within(test.screen.getByRole('group', { name: 'DataImport' }))
          .getByLabelText('DataImport')
      )
      .toBeDisabled();
    test.expect(test.screen.getByRole('button', { name: 'DataDelete' })).toBeDisabled();
    test.expect(test.screen.getByRole('button', { name: 'DataCreate' })).toBeDisabled();
    test.expect(test.screen.getByRole('button', { name: 'DataPreview' })).toBeDisabled();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'DataDiscard' }));
    const confirmation = test.screen.getAllByRole('button', { name: 'DataDiscard' }).at(-1)!;

    test.expect(confirmation).toBeDisabled();
    test.fireEvent.change(
      test.screen.getByRole('textbox', { name: 'DeleteConfirmationInstruction' }),
      {
        target: { value: 'DeleteConfirmationWord' }
      }
    );
    test.fireEvent.click(confirmation);
    test.expect(value.owner.discard).toHaveBeenCalledOnce();
  }
);

test.stable(
  'renders distinct current and backup counts for every scope outside diagnostics',
  () => {
    const value = model();

    value.state.preview = {
      ...value.state.preview!,
      current: { ...scope, tombstones: 11, historyPrunes: 12, prunedVersions: 13 },
      backup: {
        ...backup,
        scope: { ...scope, tombstones: 21, historyPrunes: 22, prunedVersions: 23 }
      },
      blockedByCurrentBarriers: true
    };
    value.state.status = { ...value.state.status!, recoveryCopy: true };
    supply(value);
    test.render(<DataSettings />);
    const table = test.screen.getByRole('table');

    for (const [key, current, archived] of [
      ['materials', '1', '1'],
      ['versions', '2', '2'],
      ['pages', '3', '3'],
      ['sources', '4', '4'],
      ['collections', '5', '5'],
      ['notes', '6', '6'],
      ['annotations', '7', '7'],
      ['quizAttempts', '8', '8'],
      ['cardReviews', '9', '9'],
      ['practiceSlots', '10', '10'],
      ['tombstones', '11', '21'],
      ['historyPrunes', '12', '22'],
      ['prunedVersions', '13', '23']
    ]) {
      const row = test
        .within(table)
        .getByRole('rowheader', { name: `DataScope${key}` })
        .closest('tr')!;

      test.expect(row).toBeVisible();
      test
        .expect(
          test
            .within(row)
            .getAllByRole('cell')
            .map((cell) => cell.textContent)
        )
        .toEqual([current, archived]);
    }

    for (const warning of ['DataRestoreWarning', 'DataBlocked', 'DataRecoveryBlocked']) {
      test.expect(test.screen.getByText(warning)).toBeVisible();
      test.expect(test.screen.getByText(warning).closest('details')).toBeNull();
    }

    test.expect(test.screen.getByRole('button', { name: 'DataAccept' })).toBeDisabled();
  }
);

test.stable.each(['busy', 'uncertain', 'status-error', 'restart-required'])(
  'keeps recovery controls fenced for %s',
  (mode) => {
    const value = model();

    value.state.preview = undefined;
    value.state.status = { state: 'activation-failed', backupId: id, recoveryCopy: true };

    if (mode === 'busy') value.state.busy = true;

    if (mode === 'uncertain') value.state.uncertain = { kind: 'discard' };

    if (mode === 'status-error') {
      value.state.statusReady = false;
      value.state.error = 'read';
    }

    if (mode === 'restart-required')
      value.state.status = { ...value.state.status, state: 'restart-required' };

    supply(value);
    test.render(<DataSettings />);
    test.expect(test.screen.getByRole('button', { name: 'DataDiscard' })).toBeDisabled();
    test.expect(test.screen.getByRole('button', { name: 'DataCreate' })).toBeDisabled();

    if (mode === 'status-error')
      test.expect(test.screen.getByText('DataStatusError')).toBeVisible();

    if (mode === 'busy' || mode === 'uncertain')
      test.expect(test.screen.getByRole('button', { name: 'DataDownload' })).toBeDisabled();
  }
);

test.stable(
  'requires a fresh deliberate confirmation each time snapshot deletion is opened',
  async () => {
    const value = model();

    value.state.preview = undefined;
    supply(value);
    test.render(<DataSettings />);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'DataDelete' }));
    let dialog = test.screen.getByRole('alertdialog');

    test.expect(test.within(dialog).getByText(/date:0.001/)).toBeVisible();
    test.expect(test.within(dialog).getByText('DataDeleteWarning')).toBeVisible();
    test.expect(test.within(dialog).getByRole('button', { name: 'DataDelete' })).toBeDisabled();
    test.fireEvent.change(
      test.within(dialog).getByRole('textbox', { name: 'DeleteConfirmationInstruction' }),
      {
        target: { value: 'DeleteConfirmationWord' }
      }
    );
    test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'Cancel' }));
    await test.waitFor(() => test.expect(test.screen.queryByRole('alertdialog')).toBeNull());
    test.fireEvent.click(test.screen.getByRole('button', { name: 'DataDelete' }));
    dialog = test.screen.getByRole('alertdialog');
    test
      .expect(test.within(dialog).getByRole('textbox', { name: 'DeleteConfirmationInstruction' }))
      .toHaveValue('');
    test.fireEvent.change(
      test.within(dialog).getByRole('textbox', { name: 'DeleteConfirmationInstruction' }),
      {
        target: { value: 'DeleteConfirmationWord' }
      }
    );
    test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'DataDelete' }));
    test.expect(value.owner.delete).toHaveBeenCalledWith(id);
  }
);

test.stable(
  'keeps uncertainty visible and acknowledgment disabled until canonical discovery completes',
  () => {
    const value = model();

    value.state.preview = undefined;
    value.state.uncertain = { kind: 'delete', id };
    value.state.reconciled = false;
    value.state.error = 'read';
    value.state.listReady = false;
    supply(value);
    const { rerender } = test.render(<DataSettings />);

    test.expect(test.screen.getByText('DataUncertain')).toBeVisible();
    test.expect(test.screen.getByRole('button', { name: 'DataAcknowledge' })).toBeDisabled();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'DataRefresh' }));
    test.expect(value.owner.refresh).toHaveBeenCalledOnce();
    test.expect(value.owner.acknowledgeUncertain).not.toHaveBeenCalled();
    value.state.reconciled = true;
    supply(value);
    rerender(<DataSettings />);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'DataAcknowledge' }));
    test.expect(value.owner.acknowledgeUncertain).toHaveBeenCalledOnce();
  }
);

test.stable('opens the native backup picker from the shared choose-file button', () => {
  const value = model();

  value.state.preview = undefined;
  supply(value);
  test.render(<DataSettings />);
  const input = test
    .within(test.screen.getByRole('group', { name: 'DataImport' }))
    .getByLabelText('DataImport') as HTMLInputElement;
  const choose = test.vi.spyOn(input, 'click').mockImplementation(() => {});

  test.expect(input).toHaveAttribute('accept', '.studybackup');
  test.expect(input).toHaveAttribute('tabindex', '-1');
  test.fireEvent.click(test.screen.getByRole('button', { name: 'DataChooseFile' }));
  test.expect(choose).toHaveBeenCalledOnce();
  test.expect(value.owner.importFile).not.toHaveBeenCalled();
});

test.stable('does not replay a retained receipt as inline operation feedback', () => {
  const value = model();

  value.state.preview = undefined;
  value.state.submitted = { kind: 'create' };
  value.state.receipt = backup;
  supply(value);
  test.render(<DataSettings />);
  test.expect(test.screen.queryByText('DataBackupCreated')).toBeNull();
  test.expect(test.screen.queryByText('DataSubmitted')).toBeNull();
  test.expect(test.screen.queryByText('DataReceipt')).toBeNull();
  test.expect(test.screen.queryByText(id)).toBeNull();
  test.expect(test.screen.queryByText('workspace.details')).toBeNull();
});

test.stable(
  'keeps the exact restore review visible while pending and closes only after its committed receipt',
  async () => {
    const value = model();
    const reviewed = value.state.preview!;
    let finish!: () => void;

    test.vi.mocked(value.owner.accept).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    test.vi.spyOn(value.owner, 'snapshot').mockImplementation(() => value.state);
    supply(value);
    const view = test.render(<DataSettings />);
    const confirm = test.screen.getByRole('button', { name: 'DataAccept' });

    test.fireEvent.click(confirm);
    test.expect(value.owner.accept).not.toHaveBeenCalled();
    test.fireEvent.change(
      test.screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }),
      {
        target: { value: 'DataRestoreConfirmationWord' }
      }
    );
    test.fireEvent.click(confirm);
    test.expect(value.owner.accept).toHaveBeenCalledExactlyOnceWith(reviewed);
    value.state = { ...value.state, busy: true, preview: undefined };
    supply(value);
    view.rerender(<DataSettings />);
    test.expect(test.screen.getByRole('alertdialog', { name: 'DataPreview' })).toBeVisible();
    test.expect(test.screen.getByRole('table')).toBeVisible();
    test.expect(test.screen.getByRole('textbox')).toBeDisabled();
    test.expect(test.screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    value.state = {
      ...value.state,
      busy: false,
      receipt: { state: 'restart-required', backupId: id, recoveryCopy: false }
    };
    supply(value);
    await test.act(async () => finish());
    view.rerender(<DataSettings />);
    await test.waitFor(() => test.expect(test.screen.queryByRole('alertdialog')).toBeNull());
  }
);

test.stable(
  'keeps an uncertain restore visible and fenced until the user returns to recovery',
  async () => {
    const value = model();
    let finish!: () => void;

    test.vi.mocked(value.owner.accept).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    test.vi.spyOn(value.owner, 'snapshot').mockImplementation(() => value.state);
    supply(value);
    const view = test.render(<DataSettings />);

    test.fireEvent.change(
      test.screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }),
      {
        target: { value: 'DataRestoreConfirmationWord' }
      }
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'DataAccept' }));
    value.state = { ...value.state, preview: undefined, uncertain: { kind: 'accept', id } };
    supply(value);
    await test.act(async () => finish());
    view.rerender(<DataSettings />);
    const dialog = test.screen.getByRole('alertdialog', { name: 'DataPreview' });

    test.expect(test.within(dialog).getByText('DataUncertain')).toBeVisible();
    test.expect(test.within(dialog).getByRole('button', { name: 'DataAccept' })).toBeDisabled();
    test.expect(test.within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  }
);

test.stable(
  'keeps deletion pending until a new receipt for the exact selected backup is confirmed',
  async () => {
    const value = model();

    value.state.preview = undefined;
    let finish!: () => void;

    test.vi.mocked(value.owner.delete).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    test.vi.spyOn(value.owner, 'snapshot').mockImplementation(() => value.state);
    supply(value);
    const view = test.render(<DataSettings />);

    test.fireEvent.click(test.screen.getByRole('button', { name: 'DataDelete' }));
    const dialog = test.screen.getByRole('alertdialog');

    test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'DataDelete' }));
    test.expect(value.owner.delete).not.toHaveBeenCalled();
    test.fireEvent.change(test.within(dialog).getByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    test.fireEvent.click(test.within(dialog).getByRole('button', { name: 'DataDelete' }));
    test.expect(value.owner.delete).toHaveBeenCalledExactlyOnceWith(id);
    value.state = { ...value.state, busy: true };
    supply(value);
    view.rerender(<DataSettings />);
    test.expect(test.screen.getByRole('alertdialog')).toBeVisible();
    test.expect(test.screen.getByRole('textbox')).toBeDisabled();
    value.state = {
      ...value.state,
      busy: false,
      submitted: { kind: 'delete', id },
      receipt: { completed: true }
    };
    supply(value);
    await test.act(async () => finish());
    view.rerender(<DataSettings />);
    await test.waitFor(() => test.expect(test.screen.queryByRole('alertdialog')).toBeNull());
  }
);
