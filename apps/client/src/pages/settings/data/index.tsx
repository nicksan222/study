import { MAX_MANAGED_BACKUPS, restoreStatusSchema } from '@study/contracts/system/backups';
import type { BackupId, RestorePreview } from '@study/contracts/system/backups';
import { mediaSize } from '@study/localization';
import { Button } from '@study/ui/button';
import { DangerDialog, DangerDialogContext } from '@study/ui/danger-dialog';
import { DataManagement } from '@study/ui/data-management';
import { ErrorState } from '@study/ui/error-state';
import { IconButton } from '@study/ui/icon-button';
import { Settings } from '@study/ui/settings';
import { StatusMessage } from '@study/ui/status-message';
import { Schema } from 'effect';
import { Archive, Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { useDataSettings } from './use-data';

type BackupDeletion = { id: BackupId } | 'recovery';

type BackupState = ReturnType<ReturnType<typeof useDataSettings>['owner']['snapshot']>;

/** Accepts only a new, certain receipt for the exact submitted deletion or recovery discard. */
function deletionConfirmed(
  target: BackupDeletion,
  before: BackupState['receipt'],
  state: BackupState
) {
  if (!state.receipt || state.receipt === before || state.uncertain) return false;

  if (target === 'recovery') return state.submitted?.kind === 'discard';

  return state.submitted?.kind === 'delete' && state.submitted.id === target.id;
}

type DataView = ReturnType<typeof useDataSettings> & {
  busy: boolean;
  mutable: boolean;
  canDiscard: boolean;
};

type DeletionControl = { setDeletion: (target: BackupDeletion | undefined) => void };

/** Derive mutation gates from the same reconciled owner state. */
export function DataSettings() {
  const { state, owner } = useDataSettings();
  const [deletion, setDeletion] = useState<BackupDeletion>();
  const busy = state.busy || !!state.uncertain;
  const disabled = busy || !state.statusReady || !state.listReady || !!state.error;
  const canDiscard = discardAllowed(state, busy);
  const mutable = !disabled && state.status?.state !== 'restart-required';
  const view = { state, owner, busy, mutable, canDiscard };

  return (
    <>
      <BackupControls {...view} />
      <SavedBackups {...view} setDeletion={setDeletion} />
      <RestoreStatus {...view} setDeletion={setDeletion} />
      <RestoreDialog {...view} />
      <DeletionDialog {...view} deletion={deletion} setDeletion={setDeletion} />
    </>
  );
}

/** Keep imports and creation behind the same capacity and mutation gates. */
function BackupControls({ state, owner, mutable }: DataView) {
  const { t, number } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
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
      <DataManagement.Description>{t('DataSettingsDescription')}</DataManagement.Description>
      <BackupFeedback state={state} owner={owner} />
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
          <DataManagement.File
            ref={fileInput}
            type="file"
            accept=".studybackup"
            aria-label={t('DataImport')}
            disabled={!mutable || state.backups.length >= MAX_MANAGED_BACKUPS}
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
  );
}

/** Render stable backup identities while recovery blocks mutations. */
function SavedBackups({ state, owner, busy, mutable, setDeletion }: DataView & DeletionControl) {
  const { t, date, locale } = useI18n();

  return (
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
            <DataManagement.Actions>
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
              <IconButton
                size="icon-sm"
                variant="ghost-destructive"
                label={t('DataDelete')}

                disabled={!mutable}
                onClick={() => {
                  setDeletion({ id: backup.id });
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </IconButton>
            </DataManagement.Actions>
          </Settings.Row>
        ))}
      </Settings.Group>
    </Settings.Section>
  );
}

/** Preserve the recovery copy whenever a restart is pending. */
function RestoreStatus({ state, canDiscard, setDeletion }: DataView & DeletionControl) {
  const { t } = useI18n();

  return (
    <>
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
              <DataManagement.StatusIcon idle={state.status.state === 'idle'} />
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
    </>
  );
}

/** Retain the reviewed preview until a matching certain restore receipt arrives. */
function RestoreDialog({ state, owner, mutable }: DataView) {
  const { t } = useI18n();
  const [restoreAttempt, setRestoreAttempt] = useState<RestorePreview>();
  const preview = restoreAttempt ?? state.preview;

  return (
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

        if (restoreConfirmed(reviewed, before, outcome)) {
          setRestoreAttempt(undefined);
          owner.clearPreview();
        }
      }}
    >
      {preview && <RestorePreviewContent state={state} preview={preview} />}
    </DangerDialog>
  );
}

/** Close confirmation only after this target has a new certain receipt. */
function DeletionDialog({
  state,
  owner,
  mutable,
  canDiscard,
  deletion,
  setDeletion
}: DataView & DeletionControl & { deletion: BackupDeletion | undefined }) {
  const { t, date, locale } = useI18n();

  /** Keep failed or uncertain destructive attempts visible until the receipt matches. */
  async function confirmDeletion() {
    if (!deletion || (deletion === 'recovery' ? !canDiscard : !mutable)) return;

    const target = deletion;
    const before = owner.snapshot().receipt;

    if (target === 'recovery') await owner.discard();
    else await owner.delete(target.id);

    if (deletionConfirmed(target, before, owner.snapshot())) setDeletion(undefined);
  }

  return (
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
        identity: deletionIdentity(deletion, state.status),
        value: t('DeleteConfirmationWord'),
        label: t('DeleteConfirmationInstruction', { word: t('DeleteConfirmationWord') })
      }}
      onConfirm={confirmDeletion}
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

      {state.uncertain && <ErrorState title={t('DataUncertain')} />}
      {state.error && <ErrorState title={t('DataReadError')} />}
    </DangerDialog>
  );
}

/** Discard requires a reconciled status and must never interrupt a pending restart. */
function discardAllowed(state: BackupState, busy: boolean) {
  return (
    !busy &&
    state.statusReady &&
    !!state.status &&
    state.status.state !== 'restart-required' &&
    (state.status.recoveryCopy || state.status.state !== 'idle')
  );
}

/** Keep uncertain acknowledgements gated until refresh reconciles the owner. */
function BackupFeedback({ state, owner }: ReturnType<typeof useDataSettings>) {
  const { t } = useI18n();

  return (
    <>
      {state.busy && <StatusMessage>{t('DataPending')}</StatusMessage>}
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
    </>
  );
}

/** Only a new certain receipt for the reviewed backup completes restore confirmation. */
function restoreConfirmed(
  reviewed: RestorePreview,
  before: BackupState['receipt'],
  outcome: BackupState
) {
  return (
    outcome.receipt !== before &&
    !outcome.uncertain &&
    Schema.is(restoreStatusSchema)(outcome.receipt) &&
    outcome.receipt.state === 'restart-required' &&
    outcome.receipt.backupId === reviewed.backup.id
  );
}

/** Bind typed confirmation to the recovery status or managed backup identity. */
function deletionIdentity(deletion: BackupDeletion | undefined, status: BackupState['status']) {
  return deletion === 'recovery'
    ? `recovery:${status?.backupId ?? ''}:${status?.state ?? ''}:${status?.recoveryCopy}`
    : (deletion?.id ?? 'no-backup');
}

/** Show the complete reviewed scope and every barrier before a restore can be accepted. */
function RestorePreviewContent({
  state,
  preview
}: {
  state: BackupState;
  preview: RestorePreview;
}) {
  const { t, number, date, locale } = useI18n();

  return (
    <DataManagement.PreviewContent>
      <DangerDialogContext>
        <Archive aria-hidden="true" />
        <span>{date(preview.backup.createdAtMs / 1000)}</span>
        <span>{mediaSize(locale, preview.backup.bytes)}</span>
      </DangerDialogContext>
      <DataManagement.Scope>
        <DataManagement.ScopeCaption>{t('DataScope')}</DataManagement.ScopeCaption>
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
              <DataManagement.ScopeLabel scope="row">
                {t(`DataScope${key}`)}
              </DataManagement.ScopeLabel>
              <td>{number(preview.current[key])}</td>
              <td>{number(preview.backup.scope[key])}</td>
            </tr>
          ))}
        </tbody>
      </DataManagement.Scope>
      {preview.blockedByCurrentBarriers && <ErrorState title={t('DataBlocked')} />}
      {state.status?.recoveryCopy && <ErrorState title={t('DataRecoveryBlocked')} />}
      {state.uncertain && <ErrorState title={t('DataUncertain')} />}
      {state.error && <ErrorState title={t('DataReadError')} />}
    </DataManagement.PreviewContent>
  );
}
