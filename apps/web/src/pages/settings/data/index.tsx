import { MAX_MANAGED_BACKUPS } from '@study/contracts/system/backups';
import type { BackupId } from '@study/contracts/system/backups';
import { Button } from '@study/ui/button';
import { DataManagement } from '@study/ui/data-management';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@study/ui/dialog';
import { ErrorState } from '@study/ui/error-state';
import { Settings } from '@study/ui/settings';
import { useState } from 'react';

import { useI18n } from '../../../lib/i18n';
import { useDataSettings } from './use-data';

function useDataView() {
  const { t, number, date } = useI18n();
  const { state, owner } = useDataSettings();
  const [deletion, setDeletion] = useState<{ id: BackupId } | 'recovery'>();
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedToken, setConfirmedToken] = useState<string>();
  const busy = state.busy || !!state.uncertain;
  const disabled = busy || !state.statusReady || !state.listReady || !!state.error;
  const canDiscard = recoveryDiscardAllowed(state, busy);
  const mutable = !disabled && state.status?.state !== 'restart-required';
  const preview = state.preview;

  return {
    t,
    number,
    date,
    state,
    owner,
    deletion,
    setDeletion,
    confirmed,
    setConfirmed,
    confirmedToken,
    setConfirmedToken,
    busy,
    canDiscard,
    mutable,
    preview
  };
}

type DataView = ReturnType<typeof useDataView>;

export function DataSettings() {
  const view = useDataView();
  const { t, state, owner, setConfirmedToken } = view;

  return (
    <Settings.Section
      title={t('DataSettingsTitle')}
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={state.busy}
          onClick={() => {
            setConfirmedToken(undefined);
            void owner.refresh();
          }}
        >
          {t('DataRefresh')}
        </Button>
      }
    >
      <DataNotices view={view} />
      <BackupCatalog view={view} />
      <RecoveryStatus view={view} />
      <PreviewDialog view={view} />
      <DeletionDialog view={view} />
    </Settings.Section>
  );
}

function DataNotices({ view }: { view: DataView }) {
  const { t, state, owner } = view;

  return (
    <>
      <DataManagement.Description>{t('DataSettingsDescription')}</DataManagement.Description>
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
          {t('DataUncertain')} <span>{state.uncertain.id ?? state.uncertain.fileName}</span>
        </Settings.Status>
      )}
      <DataReceipts view={view} />
    </>
  );
}

function BackupCatalog({ view }: { view: DataView }) {
  const {
    t,
    number,
    date,
    state,
    owner,
    setDeletion,
    setConfirmed,
    setConfirmedToken,
    busy,
    mutable
  } = view;

  return (
    <>
      <Settings.Group>
        <Settings.Row
          title={t('DataCreate')}
          description={`${number(state.backups.length)} / ${number(MAX_MANAGED_BACKUPS)}`}
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
        <Settings.Row title={t('DataImport')} description={t('DataFileError')}>
          <DataManagement.File
            type="file"
            accept=".studybackup"
            aria-label={t('DataImport')}
            disabled={!mutable || state.backups.length >= MAX_MANAGED_BACKUPS}

            onChange={(event) => {
              const file = event.currentTarget.files?.[0];

              event.currentTarget.value = '';

              if (file) void owner.importFile(file);
            }}
          />
        </Settings.Row>
        {state.backups.map((backup) => (
          <Settings.Row
            key={backup.id}
            title={date(backup.createdAtMs / 1000)}
            description={`${number(backup.bytes)} B`}
          >
            <DataManagement.Actions>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void owner.download(backup.id)}
              >
                {t('DataDownload')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!mutable}
                onClick={() => {
                  setConfirmedToken(undefined);
                  void owner.preview(backup.id);
                }}
              >
                {t('DataPreview')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!mutable}
                onClick={() => {
                  setConfirmed(false);
                  setDeletion({ id: backup.id });
                }}
              >
                {t('DataDelete')}
              </Button>
            </DataManagement.Actions>
          </Settings.Row>
        ))}
      </Settings.Group>
      {state.loaded && !state.backups.length && <Settings.Empty>{t('DataEmpty')}</Settings.Empty>}
    </>
  );
}

function RecoveryStatus({ view }: { view: DataView }) {
  const { t, state, setDeletion, setConfirmed, canDiscard } = view;

  return (
    <>
      {state.status && (
        <Settings.Section title={t('DataStatus')}>
          <Settings.Group>
            <Settings.Row
              title={t(`DataState${state.status.state}`)}
              description={state.status.backupId ?? ''}
            >
              {null}
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
                    setConfirmed(false);
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

function PreviewDialog({ view }: { view: DataView }) {
  const { t, number, date, state, owner, confirmedToken, setConfirmedToken, preview } = view;
  const blocked = restoreBlocked(view);

  return (
    <>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) {
            owner.clearPreview();
            setConfirmedToken(undefined);
          }
        }}
      >
        <DataManagement.PreviewPopup closeLabel={t('Close')}>
          <DialogHeader>
            <DialogTitle>{t('DataPreview')}</DialogTitle>
          </DialogHeader>
          {preview && (
            <DataManagement.DialogContent>
              <p>{t('DataRestoreWarning')}</p>
              <details>
                <DataManagement.DetailsToggle>
                  {t('workspace.details')}
                </DataManagement.DetailsToggle>
                <DataManagement.Details>
                  <dt>{t('DataBackup')}</dt>
                  <dd>{preview.backup.id}</dd>
                  <dt>{t('DataCreated')}</dt>
                  <dd>{date(preview.backup.createdAtMs / 1000)}</dd>
                  <dt>{t('DataBytes')}</dt>
                  <dd>{number(preview.backup.bytes)}</dd>
                  <dt>{t('DataFormat')}</dt>
                  <dd>
                    {preview.backup.format} / {number(preview.backup.version)}
                  </dd>
                  <dt>{t('DataSchema')}</dt>
                  <dd>{preview.backup.schema}</dd>
                  <dt>{t('DataToken')}</dt>
                  <dd>{preview.token}</dd>
                  <dt>{t('DataDigest')}</dt>
                  <dd>{preview.backup.sha256}</dd>
                  <dt>{t('DataTarget')}</dt>
                  <dd>{preview.target}</dd>
                </DataManagement.Details>
              </details>
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
              {preview.blockedByCurrentBarriers && (
                <ErrorState title={t('ErrorStateTitle')} description={t('DataBlocked')} />
              )}
              {state.status?.recoveryCopy && (
                <ErrorState title={t('ErrorStateTitle')} description={t('DataRecoveryBlocked')} />
              )}
              <DataManagement.Consent>
                <input
                  type="checkbox"
                  checked={confirmedToken === preview.token}
                  disabled={blocked}
                  onChange={(event) =>
                    setConfirmedToken(event.target.checked ? preview.token : undefined)
                  }
                />
                {t('DataConfirmRestore')}
              </DataManagement.Consent>
              <Button
                disabled={blocked || confirmedToken !== preview.token}
                onClick={() => {
                  if (confirmedToken === preview.token) void owner.accept(preview);
                }}
              >
                {t('DataAccept')}
              </Button>
            </DataManagement.DialogContent>
          )}
        </DataManagement.PreviewPopup>
      </Dialog>
    </>
  );
}

function DeletionDialog({ view }: { view: DataView }) {
  const { t, owner, deletion, setDeletion, confirmed, setConfirmed, canDiscard, mutable } = view;

  return (
    <>
      <Dialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open) setDeletion(undefined);
        }}
      >
        <DialogPopup closeLabel={t('Close')}>
          <DialogHeader>
            <DialogTitle>{t(deletion === 'recovery' ? 'DataDiscard' : 'DataDelete')}</DialogTitle>
          </DialogHeader>
          <DataManagement.DialogContent>
            <p>{t(deletion === 'recovery' ? 'DataDiscardWarning' : 'DataDeleteWarning')}</p>
            {deletion && deletion !== 'recovery' && (
              <DataManagement.Identity>{deletion.id}</DataManagement.Identity>
            )}
            <DataManagement.Consent>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {t('DataDeliberate')}
            </DataManagement.Consent>
          </DataManagement.DialogContent>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletion(undefined)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={!confirmed || (deletion === 'recovery' ? !canDiscard : !mutable)}
              onClick={() => {
                if (!confirmed || !deletion || (deletion === 'recovery' ? !canDiscard : !mutable))
                  return;

                if (deletion === 'recovery') void owner.discard();
                else void owner.delete(deletion.id);

                setDeletion(undefined);
              }}
            >
              {t(deletion === 'recovery' ? 'DataDiscard' : 'DataDelete')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function recoveryDiscardAllowed(state: ReturnType<typeof useDataSettings>['state'], busy: boolean) {
  return (
    !busy &&
    state.statusReady &&
    !!state.status &&
    state.status.state !== 'restart-required' &&
    (state.status.recoveryCopy || state.status.state !== 'idle')
  );
}

function restoreBlocked(view: DataView) {
  return (
    !view.mutable || !!view.preview?.blockedByCurrentBarriers || !!view.state.status?.recoveryCopy
  );
}

function DataReceipts({ view }: { view: DataView }) {
  const { t, state } = view;

  return (
    <>
      {state.submitted && (
        <DataManagement.Submitted>
          <DataManagement.DetailsToggle>{t('workspace.details')}</DataManagement.DetailsToggle>
          <p>
            {t('DataSubmitted')}:{' '}
            {t(
              (
                {
                  create: 'DataCreate',
                  import: 'DataImport',
                  delete: 'DataDelete',
                  accept: 'DataAccept',
                  discard: 'DataDiscard'
                } as const
              )[state.submitted.kind]
            )}
          </p>
          <p>{state.submitted.id ?? state.submitted.fileName}</p>
          {state.submitted.acceptance && (
            <dl>
              <dt>{t('DataToken')}</dt>
              <dd>{state.submitted.acceptance.token}</dd>
              <dt>{t('DataDigest')}</dt>
              <dd>{state.submitted.acceptance.sha256}</dd>
              <dt>{t('DataTarget')}</dt>
              <dd>{state.submitted.acceptance.target}</dd>
            </dl>
          )}
        </DataManagement.Submitted>
      )}
      {state.receipt && (
        <DataManagement.Receipt role="status">
          {t('DataReceipt')}{' '}
          {'id' in state.receipt
            ? state.receipt.id
            : 'state' in state.receipt
              ? t(`DataState${state.receipt.state}`)
              : null}
        </DataManagement.Receipt>
      )}
    </>
  );
}
