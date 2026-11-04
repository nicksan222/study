import { backupIdSchema, restoreTokenSchema } from '@study/contracts/system/backups';
import { testStable } from '@study/testing/vitest';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Schema } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { DataSettings } from './index';
import type * as MockModule0 from './use-data';
import { dataOwner, useDataSettings } from './use-data';
vi.mock('./use-data', async (load) => ({
  ...(await load<typeof MockModule0>()),
  useDataSettings: vi.fn()
}));
vi.mock('#web/lib/i18n.tsx', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'english',
    number: String,
    date: (seconds: number | bigint) => `date:${seconds}`
  })
}));

const id = Schema.decodeUnknownSync(backupIdSchema)('11111111-1111-4111-8111-111111111111');

const scope = {
  materials: 1,
  versions: 2,
  documents: 3,
  documentVersions: 4,
  extractions: 2,
  documentRetirements: 0,
  sources: 4,
  collections: 5,
  sessions: 6,
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
  version: 1 as const,
  createdAtMs: 1,
  schema: 'a'.repeat(64),
  sha256: 'b'.repeat(64),
  bytes: 100,
  scope,
  credentials: 'excluded' as const,
  nativeWork: 'retired' as const,
  compatibility: 'exact-schema' as const
};

function model() {
  const owner = dataOwner(new QueryClient());

  vi.spyOn(owner, 'refresh').mockResolvedValue(undefined);
  vi.spyOn(owner, 'create').mockResolvedValue(undefined);
  vi.spyOn(owner, 'importFile').mockResolvedValue(undefined);
  vi.spyOn(owner, 'download').mockResolvedValue(undefined);
  vi.spyOn(owner, 'preview').mockResolvedValue(undefined);
  vi.spyOn(owner, 'delete').mockResolvedValue(undefined);
  vi.spyOn(owner, 'discard').mockResolvedValue(undefined);
  vi.spyOn(owner, 'accept').mockResolvedValue(undefined);
  vi.spyOn(owner, 'clearPreview').mockImplementation(() => {});
  vi.spyOn(owner, 'acknowledgeUncertain').mockImplementation(() => {});
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
  vi.mocked(useDataSettings).mockReturnValue(value);
}

beforeEach(() => vi.clearAllMocks());

testStable(
  'shows complete scopes and requires deliberate acceptance of the exact reviewed backup',
  () => {
    const value = model();

    supply(value);
    render(<DataSettings />);
    expect(screen.getByText('DataRestoreWarning')).toBeInTheDocument();
    Object.keys(scope).forEach((key) =>
      expect(screen.getByText(`DataScope${key}`)).toBeInTheDocument()
    );
    expect(screen.queryByText(backup.schema)).toBeNull();
    const accept = screen.getByRole('button', { name: 'DataAccept' });

    expect(accept).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }), {
      target: { value: 'DataRestoreConfirmationWord' }
    });
    fireEvent.click(accept);
    expect(value.owner.accept).toHaveBeenCalledWith(value.state.preview);
  }
);

testStable('resets deliberate intent when the preview token changes and blocks barriers', () => {
  const value = model();

  supply(value);
  const { rerender } = render(<DataSettings />);

  fireEvent.change(screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }), {
    target: { value: 'DataRestoreConfirmationWord' }
  });
  value.state.preview = {
    ...value.state.preview!,
    token: Schema.decodeUnknownSync(restoreTokenSchema)('22222222-2222-4222-8222-222222222222')
  };
  supply(value);
  rerender(<DataSettings />);
  expect(screen.getByRole('button', { name: 'DataAccept' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' })).toHaveValue(
    ''
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }), {
    target: { value: 'DataRestoreConfirmationWord' }
  });
  expect(screen.getByRole('button', { name: 'DataAccept' })).toBeEnabled();
  value.state.preview = { ...value.state.preview!, blockedByCurrentBarriers: true };
  supply(value);
  rerender(<DataSettings />);
  expect(screen.getByText('DataBlocked')).toBeInTheDocument();
  expect(
    screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' })
  ).toBeDisabled();
  expect(value.owner.accept).not.toHaveBeenCalled();
  value.state.preview = { ...value.state.preview!, blockedByCurrentBarriers: false };
  supply(value);
  rerender(<DataSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'DataAccept' }));
  expect(value.owner.accept).toHaveBeenCalledWith(value.state.preview);
});

testStable('requires deliberate recovery discard', () => {
  const value = model();

  value.state.preview = undefined;
  value.state.status = { ...value.state.status!, recoveryCopy: true };
  supply(value);
  render(<DataSettings />);
  expect(screen.getByText('DataRecovery')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'DataDiscard' }));
  const buttons = screen.getAllByRole('button', { name: 'DataDiscard' });

  expect(buttons.at(-1)).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'DeleteConfirmationInstruction' }), {
    target: { value: 'DeleteConfirmationWord' }
  });
  fireEvent.click(buttons.at(-1)!);
  expect(value.owner.discard).toHaveBeenCalledOnce();
});

testStable(
  'keeps implementation identities out while replacement scope and consent stay visible',
  () => {
    supply(model());
    render(<DataSettings />);
    expect(screen.queryByText(backup.schema)).toBeNull();
    expect(screen.queryByText(backup.sha256)).toBeNull();
    expect(screen.queryByText('workspace.details')).toBeNull();
    expect(screen.getByText('DataRestoreWarning')).toBeVisible();
    expect(screen.getByRole('table')).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'DataAccept' })).toBeDisabled();
  }
);

testStable(
  'keeps known downloads and deliberate recovery available when only the list is unavailable',
  () => {
    const value = model();

    value.state.preview = undefined;
    value.state.listReady = false;
    value.state.error = 'read';
    value.state.status = { ...value.state.status!, recoveryCopy: true };
    supply(value);
    render(<DataSettings />);
    expect(screen.getByText('DataListError')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'DataDownload' }));
    expect(value.owner.download).toHaveBeenCalledWith(id);
    expect(
      within(screen.getByRole('group', { name: 'DataImport' })).getByLabelText('DataImport')
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DataDelete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DataCreate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DataPreview' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'DataDiscard' }));
    const confirmation = screen.getAllByRole('button', { name: 'DataDiscard' }).at(-1)!;

    expect(confirmation).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'DeleteConfirmationInstruction' }), {
      target: { value: 'DeleteConfirmationWord' }
    });
    fireEvent.click(confirmation);
    expect(value.owner.discard).toHaveBeenCalledOnce();
  }
);

testStable('renders distinct current and backup counts for every scope outside diagnostics', () => {
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
  render(<DataSettings />);
  const table = screen.getByRole('table');

  for (const [key, current, archived] of [
    ['materials', '1', '1'],
    ['versions', '2', '2'],
    ['documents', '3', '3'],
    ['sources', '4', '4'],
    ['collections', '5', '5'],
    ['sessions', '6', '6'],
    ['annotations', '7', '7'],
    ['quizAttempts', '8', '8'],
    ['cardReviews', '9', '9'],
    ['practiceSlots', '10', '10'],
    ['tombstones', '11', '21'],
    ['historyPrunes', '12', '22'],
    ['prunedVersions', '13', '23']
  ]) {
    const row = within(table)
      .getByRole('rowheader', { name: `DataScope${key}` })
      .closest('tr')!;

    expect(row).toBeVisible();
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual([current, archived]);
  }

  for (const warning of ['DataRestoreWarning', 'DataBlocked', 'DataRecoveryBlocked']) {
    expect(screen.getByText(warning)).toBeVisible();
    expect(screen.getByText(warning).closest('details')).toBeNull();
  }

  expect(screen.getByRole('button', { name: 'DataAccept' })).toBeDisabled();
});

testStable.each(['busy', 'uncertain', 'status-error', 'restart-required'])(
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
    render(<DataSettings />);
    expect(screen.getByRole('button', { name: 'DataDiscard' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DataCreate' })).toBeDisabled();

    if (mode === 'status-error') expect(screen.getByText('DataStatusError')).toBeVisible();

    if (mode === 'busy' || mode === 'uncertain')
      expect(screen.getByRole('button', { name: 'DataDownload' })).toBeDisabled();
  }
);

testStable(
  'requires a fresh deliberate confirmation each time snapshot deletion is opened',
  async () => {
    const value = model();

    value.state.preview = undefined;
    supply(value);
    render(<DataSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'DataDelete' }));
    let dialog = screen.getByRole('alertdialog');

    expect(within(dialog).getByText(/date:0.001/)).toBeVisible();
    expect(within(dialog).getByText('DataDeleteWarning')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'DataDelete' })).toBeDisabled();
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'DeleteConfirmationInstruction' }),
      {
        target: { value: 'DeleteConfirmationWord' }
      }
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'DataDelete' }));
    dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByRole('textbox', { name: 'DeleteConfirmationInstruction' })
    ).toHaveValue('');
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'DeleteConfirmationInstruction' }),
      {
        target: { value: 'DeleteConfirmationWord' }
      }
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'DataDelete' }));
    expect(value.owner.delete).toHaveBeenCalledWith(id);
  }
);

testStable(
  'keeps uncertainty visible and acknowledgment disabled until canonical discovery completes',
  () => {
    const value = model();

    value.state.preview = undefined;
    value.state.uncertain = { kind: 'delete', id };
    value.state.reconciled = false;
    value.state.error = 'read';
    value.state.listReady = false;
    supply(value);
    const { rerender } = render(<DataSettings />);

    expect(screen.getByText('DataUncertain')).toBeVisible();
    expect(screen.getByRole('button', { name: 'DataAcknowledge' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'DataRefresh' }));
    expect(value.owner.refresh).toHaveBeenCalledOnce();
    expect(value.owner.acknowledgeUncertain).not.toHaveBeenCalled();
    value.state.reconciled = true;
    supply(value);
    rerender(<DataSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'DataAcknowledge' }));
    expect(value.owner.acknowledgeUncertain).toHaveBeenCalledOnce();
  }
);

testStable('opens the native backup picker from the shared choose-file button', () => {
  const value = model();

  value.state.preview = undefined;
  supply(value);
  render(<DataSettings />);
  const input = within(screen.getByRole('group', { name: 'DataImport' })).getByLabelText(
    'DataImport'
  ) as HTMLInputElement;
  const choose = vi.spyOn(input, 'click').mockImplementation(() => {});

  expect(input).toHaveAttribute('accept', '.studybackup');
  expect(input).toHaveAttribute('tabindex', '-1');
  fireEvent.click(screen.getByRole('button', { name: 'DataChooseFile' }));
  expect(choose).toHaveBeenCalledOnce();
  expect(value.owner.importFile).not.toHaveBeenCalled();
});

testStable('does not replay a retained receipt as inline operation feedback', () => {
  const value = model();

  value.state.preview = undefined;
  value.state.submitted = { kind: 'create' };
  value.state.receipt = backup;
  supply(value);
  render(<DataSettings />);
  expect(screen.queryByText('DataBackupCreated')).toBeNull();
  expect(screen.queryByText('DataSubmitted')).toBeNull();
  expect(screen.queryByText('DataReceipt')).toBeNull();
  expect(screen.queryByText(id)).toBeNull();
  expect(screen.queryByText('workspace.details')).toBeNull();
});

testStable(
  'keeps the exact restore review visible while pending and closes only after its committed receipt',
  async () => {
    const value = model();
    const reviewed = value.state.preview!;
    let finish!: () => void;

    vi.mocked(value.owner.accept).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    vi.spyOn(value.owner, 'snapshot').mockImplementation(() => value.state);
    supply(value);
    const view = render(<DataSettings />);
    const confirm = screen.getByRole('button', { name: 'DataAccept' });

    fireEvent.click(confirm);
    expect(value.owner.accept).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }), {
      target: { value: 'DataRestoreConfirmationWord' }
    });
    fireEvent.click(confirm);
    expect(value.owner.accept).toHaveBeenCalledExactlyOnceWith(reviewed);
    value.state = { ...value.state, busy: true, preview: undefined };
    supply(value);
    view.rerender(<DataSettings />);
    expect(screen.getByRole('alertdialog', { name: 'DataPreview' })).toBeVisible();
    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    value.state = {
      ...value.state,
      busy: false,
      receipt: { state: 'restart-required', backupId: id, recoveryCopy: false }
    };
    supply(value);
    await act(async () => finish());
    view.rerender(<DataSettings />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  }
);

testStable(
  'keeps an uncertain restore visible and fenced until the user returns to recovery',
  async () => {
    const value = model();
    let finish!: () => void;

    vi.mocked(value.owner.accept).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    vi.spyOn(value.owner, 'snapshot').mockImplementation(() => value.state);
    supply(value);
    const view = render(<DataSettings />);

    fireEvent.change(screen.getByRole('textbox', { name: 'DataRestoreConfirmationInstruction' }), {
      target: { value: 'DataRestoreConfirmationWord' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'DataAccept' }));
    value.state = { ...value.state, preview: undefined, uncertain: { kind: 'accept', id } };
    supply(value);
    await act(async () => finish());
    view.rerender(<DataSettings />);
    const dialog = screen.getByRole('alertdialog', { name: 'DataPreview' });

    expect(within(dialog).getByText('DataUncertain')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'DataAccept' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  }
);

testStable(
  'keeps deletion pending until a new receipt for the exact selected backup is confirmed',
  async () => {
    const value = model();

    value.state.preview = undefined;
    let finish!: () => void;

    vi.mocked(value.owner.delete).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    vi.spyOn(value.owner, 'snapshot').mockImplementation(() => value.state);
    supply(value);
    const view = render(<DataSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'DataDelete' }));
    const dialog = screen.getByRole('alertdialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'DataDelete' }));
    expect(value.owner.delete).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'DeleteConfirmationWord' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'DataDelete' }));
    expect(value.owner.delete).toHaveBeenCalledExactlyOnceWith(id);
    value.state = { ...value.state, busy: true };
    supply(value);
    view.rerender(<DataSettings />);
    expect(screen.getByRole('alertdialog')).toBeVisible();
    expect(screen.getByRole('textbox')).toBeDisabled();
    value.state = {
      ...value.state,
      busy: false,
      submitted: { kind: 'delete', id },
      receipt: { completed: true }
    };
    supply(value);
    await act(async () => finish());
    view.rerender(<DataSettings />);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  }
);
