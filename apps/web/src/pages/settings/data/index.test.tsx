import { backupIdSchema, restoreTokenSchema } from '@study/contracts/system/backups';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Schema } from 'effect';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { DataSettings } from './index';
import { dataOwner, useDataSettings } from './use-data';
vi.mock('./use-data', async (load) => ({
  ...(await load<typeof import('./use-data')>()),
  useDataSettings: vi.fn()
}));
vi.mock('../../../lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    number: String,
    date: (seconds: number | bigint) => `date:${seconds}`
  })
}));
const id = Schema.decodeUnknownSync(backupIdSchema)('11111111-1111-4111-8111-111111111111');
const scope = {
  materials: 1,
  versions: 2,
  documents: 3,
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
it('shows complete scopes and exact identities and requires deliberate acceptance', () => {
  const value = model();
  supply(value);
  render(<DataSettings />);
  expect(screen.getByText('DataRestoreWarning')).toBeInTheDocument();
  Object.keys(scope).forEach((key) =>
    expect(screen.getByText(`DataScope${key}`)).toBeInTheDocument()
  );
  expect(screen.getByText(backup.schema)).toBeInTheDocument();
  const accept = screen.getByRole('button', { name: 'DataAccept' });
  expect(accept).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'DataConfirmRestore' }));
  fireEvent.click(accept);
  expect(value.owner.accept).toHaveBeenCalledWith(value.state.preview);
});
it('resets deliberate intent when the preview token changes and blocks barriers', () => {
  const value = model();
  supply(value);
  const { rerender } = render(<DataSettings />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'DataConfirmRestore' }));
  value.state.preview = {
    ...value.state.preview!,
    token: Schema.decodeUnknownSync(restoreTokenSchema)('22222222-2222-4222-8222-222222222222')
  };
  supply(value);
  rerender(<DataSettings />);
  expect(screen.getByRole('button', { name: 'DataAccept' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'DataConfirmRestore' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'DataConfirmRestore' }));
  fireEvent.click(screen.getByRole('button', { name: 'DataAccept' }));
  expect(value.owner.accept).toHaveBeenCalledWith(value.state.preview);
  value.state.preview = { ...value.state.preview!, blockedByCurrentBarriers: true };
  supply(value);
  rerender(<DataSettings />);
  expect(screen.getByText('DataBlocked')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'DataConfirmRestore' })).toBeDisabled();
});
it('requires deliberate recovery discard', () => {
  const value = model();
  value.state.preview = undefined;
  value.state.status!.recoveryCopy = true;
  supply(value);
  render(<DataSettings />);
  expect(screen.getByText('DataRecovery')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'DataDiscard' }));
  const buttons = screen.getAllByRole('button', { name: 'DataDiscard' });
  expect(buttons.at(-1)).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'DataDeliberate' }));
  fireEvent.click(buttons.at(-1)!);
  expect(value.owner.discard).toHaveBeenCalledOnce();
});

it('keeps diagnostic identities collapsed while replacement scope and consent stay visible', () => {
  supply(model());
  render(<DataSettings />);
  const diagnostic = screen.getByText(backup.schema).closest('details');
  expect(diagnostic).not.toHaveAttribute('open');
  expect(screen.getByText('DataRestoreWarning').closest('details')).toBeNull();
  expect(screen.getByRole('table').closest('details')).toBeNull();
  expect(
    screen.getByRole('checkbox', { name: 'DataConfirmRestore' }).closest('details')
  ).toBeNull();
  fireEvent.click(diagnostic!.querySelector('summary')!);
  expect(screen.getByRole('button', { name: 'DataAccept' })).toBeDisabled();
});

it('keeps known downloads and deliberate recovery available when only the list is unavailable', () => {
  const value = model();
  value.state.preview = undefined;
  value.state.listReady = false;
  value.state.error = 'read';
  value.state.status!.recoveryCopy = true;
  supply(value);
  render(<DataSettings />);
  expect(screen.getByText('DataListError')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'DataDownload' }));
  expect(value.owner.download).toHaveBeenCalledWith(id);
  expect(screen.getByLabelText('DataImport')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'DataDelete' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'DataCreate' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'DataPreview' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'DataDiscard' }));
  const confirmation = screen.getAllByRole('button', { name: 'DataDiscard' }).at(-1)!;
  expect(confirmation).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'DataDeliberate' }));
  fireEvent.click(confirmation);
  expect(value.owner.discard).toHaveBeenCalledOnce();
});


it('renders distinct current and backup counts for every scope outside diagnostics', () => {
  const value = model();
  value.state.preview = {
    ...value.state.preview!,
    current: { ...scope, tombstones: 11, historyPrunes: 12, prunedVersions: 13 },
    backup: { ...backup, scope: { ...scope, tombstones: 21, historyPrunes: 22, prunedVersions: 23 } },
    blockedByCurrentBarriers: true
  };
  value.state.status!.recoveryCopy = true;
  supply(value);
  render(<DataSettings />);
  const table = screen.getByRole('table');
  for (const [key, current, archived] of [
    ['materials', '1', '1'], ['versions', '2', '2'], ['documents', '3', '3'],
    ['sources', '4', '4'], ['collections', '5', '5'], ['sessions', '6', '6'],
    ['annotations', '7', '7'], ['quizAttempts', '8', '8'], ['cardReviews', '9', '9'],
    ['practiceSlots', '10', '10'], ['tombstones', '11', '21'],
    ['historyPrunes', '12', '22'], ['prunedVersions', '13', '23']
  ]) {
    const row = within(table).getByRole('rowheader', { name: `DataScope${key}` }).closest('tr')!;
    expect(row).toBeVisible();
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([current, archived]);
  }
  for (const warning of ['DataRestoreWarning', 'DataBlocked', 'DataRecoveryBlocked']) {
    expect(screen.getByText(warning)).toBeVisible();
    expect(screen.getByText(warning).closest('details')).toBeNull();
  }
  expect(screen.getByRole('button', { name: 'DataAccept' })).toBeDisabled();
});

it.each(['busy', 'uncertain', 'status-error', 'restart-required'])(
  'keeps recovery controls fenced for %s', (mode) => {
    const value = model();
    value.state.preview = undefined;
    value.state.status = { state: 'activation-failed', backupId: id, recoveryCopy: true };
    if (mode === 'busy') value.state.busy = true;
    if (mode === 'uncertain') value.state.uncertain = { kind: 'discard' };
    if (mode === 'status-error') {
      value.state.statusReady = false;
      value.state.error = 'read';
    }
    if (mode === 'restart-required') value.state.status.state = 'restart-required';
    supply(value);
    render(<DataSettings />);
    expect(screen.getByRole('button', { name: 'DataDiscard' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DataCreate' })).toBeDisabled();
    if (mode === 'status-error') expect(screen.getByText('DataStatusError')).toBeVisible();
    if (mode === 'busy' || mode === 'uncertain')
      expect(screen.getByRole('button', { name: 'DataDownload' })).toBeDisabled();
  }
);

it('requires a fresh deliberate confirmation each time snapshot deletion is opened', () => {
  const value = model();
  value.state.preview = undefined;
  supply(value);
  render(<DataSettings />);
  fireEvent.click(screen.getByRole('button', { name: 'DataDelete' }));
  let dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(id)).toBeVisible();
  expect(within(dialog).getByText('DataDeleteWarning')).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'DataDelete' })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'DataDeliberate' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'DataDelete' }));
  dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('checkbox', { name: 'DataDeliberate' })).not.toBeChecked();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'DataDeliberate' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'DataDelete' }));
  expect(value.owner.delete).toHaveBeenCalledWith(id);
});


it('keeps uncertainty visible and acknowledgment disabled until canonical discovery completes', () => {
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
});
