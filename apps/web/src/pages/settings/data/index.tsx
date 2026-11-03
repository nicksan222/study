import { MAX_MANAGED_BACKUPS, restoreStatusSchema } from '@study/contracts/system/backups';
import type { BackupId, RestorePreview } from '@study/contracts/system/backups';
import { mediaSize } from '@study/localization';
import { Button } from '@study/ui/button';
import { DangerDialog, DangerDialogContext } from '@study/ui/danger-dialog';
import { Settings } from '@study/ui/settings';
import { Schema } from 'effect';
import { Archive, CheckCircle2, Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { useI18n } from '../../../lib/i18n';
import { useDataSettings } from './use-data';

import './data.css';

type BackupDeletion = { id: BackupId } | 'recovery';
type BackupState = ReturnType<ReturnType<typeof useDataSettings>['owner']['snapshot']>;

function deletionConfirmed(
  target: BackupDeletion,
  before: BackupState['receipt'],
  state: BackupState
) {
  if (!state.receipt || state.receipt === before || state.uncertain) return false;
  if (target === 'recovery') return state.submitted?.kind === 'discard';
  return state.submitted?.kind === 'delete' && state.submitted.id === target.id;
}

export function DataSettings() {
  const { t, number, date, locale } = useI18n();
  const { state, owner } = useDataSettings();
  const fileInput = useRef<HTMLInputElement>(null);
  const [restoreAttempt, setRestoreAttempt] = useState<RestorePreview>();
  const [deletion, setDeletion] = useState<BackupDeletion>();
  const busy = state.busy || !!state.uncertain;
  const disabled = busy || !state.statusReady || !state.listReady || !!state.error;
  const canDiscard =
    !busy &&
    state.statusReady &&
    !!state.status &&
    state.status.state !== 'restart-required' &&
    (state.status.recoveryCopy || state.status.state !== 'idle');
  const mutable = !disabled && state.status?.state !== 'restart-required';
  const preview = restoreAttempt ?? state.preview;
  return (
    <>
      <Settings.Section
        title={t('DataSettingsTitle')}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={state.busy}
            onClick={() => {
              void owner.refresh();
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t('DataRefresh')}
          </Button>
        }
      >
        <p className="data-settings-intro">{t('DataSettingsDescription')}</p>
        {state.busy && <p role="status">{t('DataPending')}</p>}
        {state.error && (
          <Settings.Status>
            {t(
              state.error === 'file'
                ? 'DataFileError'
                : !state.statusReady
                  ? 'DataStatusError'
                  : !state.listReady
                    ? 'DataListError'
                    : 'DataReadError'
            )}
          </Settings.Status>
        )}
        {state.uncertain && (
          <Settings.Status
            action={
              <Button
                size="sm"
                variant="outline"
                disabled={state.busy || !state.reconciled}
                onClick={owner.acknowledgeUncertain}
              >
                {t('DataAcknowledge')}
              </Button>
            }
          >
            {t('DataUncertain')}
          </Settings.Status>
        )}
        <Settings.Group>
          <Settings.Row
            title={t('DataLocalBackups')}
            description={t('DataBackupCapacity', {
              count: number(state.backups.length),
              limit: number(MAX_MANAGED_BACKUPS)
            })}
          >
            <Button
              size="sm"
              variant="outline"
              disabled={!mutable || state.backups.length >= MAX_MANAGED_BACKUPS}
              onClick={() => void owner.create()}
            >
              {t('DataCreate')}
            </Button>
          </Settings.Row>
          <Settings.Row title={t('DataImport')} description={t('DataImportHelp')}>
            <input
              ref={fileInput}
              type="file"
              accept=".studybackup"
              aria-label={t('DataImport')}
              disabled={!mutable || state.backups.length >= MAX_MANAGED_BACKUPS}
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void owner.importFile(file);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!mutable || state.backups.length >= MAX_MANAGED_BACKUPS}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={14} aria-hidden="true" />
              {t('DataChooseFile')}
            </Button>
          </Settings.Row>
        </Settings.Group>
      </Settings.Section>
      <Settings.Section title={t('DataSavedBackups')}>
        <Settings.Group>
          {state.loaded && !state.backups.length && (
            <Settings.Empty title={t('DataEmptyTitle')} icon={<Archive aria-hidden="true" />}>
              {t('DataEmpty')}
            </Settings.Empty>
          )}
          {state.backups.map((backup) => (
            <Settings.Row
              key={backup.id}
              title={date(backup.createdAtMs / 1000)}
              description={mediaSize(locale, backup.bytes)}
            >
              <div className="data-backup-actions">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void owner.download(backup.id)}
                >
                  <Download size={14} aria-hidden="true" />
                  {t('DataDownload')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!mutable}
                  onClick={() => {
                    void owner.preview(backup.id);
                  }}
                >
                  {t('DataPreview')}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost-destructive"
                  aria-label={t('DataDelete')}
                  title={t('DataDelete')}
                  disabled={!mutable}
                  onClick={() => {
                    setDeletion({ id: backup.id });
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </div>
            </Settings.Row>
          ))}
        </Settings.Group>
      </Settings.Section>
      {state.status && (
        <Settings.Section title={t('DataStatus')}>
          <Settings.Group>
            <Settings.Row
              title={t(`DataState${state.status.state}`)}
              description={
                state.status.state === 'idle'
                  ? t('DataRestoreIdleHelp')
                  : state.status.state === 'restart-required'
                    ? t('DataRestoreRestartHelp')
                    : state.status.state === 'applied'
                      ? t('DataRestoreAppliedHelp')
                      : t('DataRestoreFailedHelp')
              }
            >
              {state.status.state === 'idle' ? (
                <CheckCircle2 size={17} aria-hidden="true" className="data-restore-idle" />
              ) : null}
            </Settings.Row>
            {state.status.recoveryCopy && (
              <Settings.Row title={t('DataRecovery')} description="">
                {null}
              </Settings.Row>
            )}
            {(state.status.recoveryCopy || state.status.state !== 'idle') && (
              <Settings.Row title={t('DataDiscard')} description="">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canDiscard}
                  onClick={() => {
                    setDeletion('recovery');
                  }}
                >
                  {t('DataDiscard')}
                </Button>
              </Settings.Row>
            )}
          </Settings.Group>
        </Settings.Section>
      )}
      <DangerDialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) {
            owner.clearPreview();
            setRestoreAttempt(undefined);
          }
        }}
        title={t('DataPreview')}
        description={t('DataRestoreWarning')}
        confirmLabel={t('DataAccept')}
        cancelLabel={t('Cancel')}
        pending={state.busy}
        disabled={
          !mutable || !preview || preview.blockedByCurrentBarriers || !!state.status?.recoveryCopy
        }
        confirmation={{
          identity: preview?.token ?? 'no-restore',
          value: t('DataRestoreConfirmationWord'),
          label: t('DataRestoreConfirmationInstruction', { word: t('DataRestoreConfirmationWord') })
        }}
        onConfirm={async () => {
          if (!preview) return;
          const reviewed = preview;
          const before = owner.snapshot().receipt;
          setRestoreAttempt(reviewed);
          await owner.accept(reviewed);
          const outcome = owner.snapshot();
          if (
            outcome.receipt !== before &&
            !outcome.uncertain &&
            Schema.is(restoreStatusSchema)(outcome.receipt) &&
            outcome.receipt.state === 'restart-required' &&
            outcome.receipt.backupId === reviewed.backup.id
          ) {
            setRestoreAttempt(undefined);
            owner.clearPreview();
          }
        }}
      >
        {preview && (
          <div className="space-y-4 text-sm">
            <DangerDialogContext>
              <Archive aria-hidden="true" />
              <span>{date(preview.backup.createdAtMs / 1000)}</span>
              <span>{mediaSize(locale, preview.backup.bytes)}</span>
            </DangerDialogContext>
            <table className="w-full text-start tabular-nums [&_th]:py-2 [&_td]:py-2 [&_td]:text-end [&_tr]:border-b [&_tr]:border-border">
              <caption className="text-start">{t('DataScope')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('DataScope')}</th>
                  <th scope="col">{t('DataCurrent')}</th>
                  <th scope="col">{t('DataBackup')}</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(preview.current) as (keyof typeof preview.current)[]).map((key) => (
                  <tr key={key}>
                    <th scope="row" className="text-start font-normal">
                      {t(`DataScope${key}`)}
                    </th>
                    <td>{number(preview.current[key])}</td>
                    <td>{number(preview.backup.scope[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.blockedByCurrentBarriers && <p role="alert">{t('DataBlocked')}</p>}
            {state.status?.recoveryCopy && <p role="alert">{t('DataRecoveryBlocked')}</p>}
            {state.uncertain && <p role="alert">{t('DataUncertain')}</p>}
            {state.error && <p role="alert">{t('DataReadError')}</p>}
          </div>
        )}
      </DangerDialog>
      <DangerDialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open) setDeletion(undefined);
        }}
        title={t(deletion === 'recovery' ? 'DataDiscard' : 'DataDelete')}
        description={t(deletion === 'recovery' ? 'DataDiscardWarning' : 'DataDeleteWarning')}
        confirmLabel={t(deletion === 'recovery' ? 'DataDiscard' : 'DataDelete')}
        cancelLabel={t('Cancel')}
        pending={state.busy}
        disabled={deletion === 'recovery' ? !canDiscard : !mutable}
        confirmation={{
          identity:
            deletion === 'recovery'
              ? `recovery:${state.status?.backupId ?? ''}:${state.status?.state ?? ''}:${state.status?.recoveryCopy}`
              : (deletion?.id ?? 'no-backup'),
          value: t('DeleteConfirmationWord'),
          label: t('DeleteConfirmationInstruction', { word: t('DeleteConfirmationWord') })
        }}
        onConfirm={async () => {
          if (!deletion || (deletion === 'recovery' ? !canDiscard : !mutable)) return;
          const target = deletion;
          const before = owner.snapshot().receipt;
          if (target === 'recovery') await owner.discard();
          else await owner.delete(target.id);
          if (deletionConfirmed(target, before, owner.snapshot())) setDeletion(undefined);
        }}
      >
        {deletion &&
          deletion !== 'recovery' &&
          state.backups
            .filter((backup) => backup.id === deletion.id)
            .map((backup) => (
              <DangerDialogContext key={backup.id}>
                <Archive aria-hidden="true" />
                <span>{date(backup.createdAtMs / 1000)}</span>
                <span>{mediaSize(locale, backup.bytes)}</span>
              </DangerDialogContext>
            ))}

        {state.uncertain && (
          <p role="alert" className="mt-3">
            {t('DataUncertain')}
          </p>
        )}
        {state.error && (
          <p role="alert" className="mt-3">
            {t('DataReadError')}
          </p>
        )}
      </DangerDialog>
    </>
  );
}
