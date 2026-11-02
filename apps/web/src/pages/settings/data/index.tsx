import { MAX_MANAGED_BACKUPS } from '@study/contracts/system/backups';
import type { BackupId } from '@study/contracts/system/backups';
import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@study/ui/dialog';
import { Settings } from '@study/ui/settings';
import { useState } from 'react';

import { useI18n } from '../../../lib/i18n';
import { useDataSettings } from './use-data';

export function DataSettings() {
  const { t, number, date } = useI18n();
  const { state, owner } = useDataSettings();
  const [deletion, setDeletion] = useState<{ id: BackupId } | 'recovery'>();
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedToken, setConfirmedToken] = useState<string>();
  const busy = state.busy || !!state.uncertain;
  const disabled = busy || !state.statusReady || !state.listReady || !!state.error;
  const canDiscard =
    !busy &&
    state.statusReady &&
    !!state.status &&
    state.status.state !== 'restart-required' &&
    (state.status.recoveryCopy || state.status.state !== 'idle');
  const mutable = !disabled && state.status?.state !== 'restart-required';
  const preview = state.preview;
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
      <p className="mb-4 text-sm text-muted-foreground">{t('DataSettingsDescription')}</p>
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
      {state.submitted && (
        <details className="mb-4 break-all text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {t('workspace.details')}
          </summary>
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
        </details>
      )}
      {state.receipt && (
        <p role="status" className="mb-4 text-sm">
          {t('DataReceipt')}{' '}
          {'id' in state.receipt
            ? state.receipt.id
            : 'state' in state.receipt
              ? t(`DataState${state.receipt.state}`)
              : null}
        </p>
      )}
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
          <input
            type="file"
            accept=".studybackup"
            aria-label={t('DataImport')}
            disabled={!mutable || state.backups.length >= MAX_MANAGED_BACKUPS}
            className="max-w-56 text-sm"
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
            <div className="flex flex-wrap justify-end gap-2">
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
            </div>
          </Settings.Row>
        ))}
      </Settings.Group>
      {state.loaded && !state.backups.length && <Settings.Empty>{t('DataEmpty')}</Settings.Empty>}
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
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) {
            owner.clearPreview();
            setConfirmedToken(undefined);
          }
        }}
      >
        <DialogPopup closeLabel={t('Close')} className="overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('DataPreview')}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4 px-6 pb-6 text-sm">
              <p>{t('DataRestoreWarning')}</p>
              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  {t('workspace.details')}
                </summary>
                <dl className="mt-3 space-y-2 break-all">
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
                </dl>
              </details>
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
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmedToken === preview.token}
                  disabled={
                    !mutable || preview.blockedByCurrentBarriers || state.status?.recoveryCopy
                  }
                  onChange={(event) =>
                    setConfirmedToken(event.target.checked ? preview.token : undefined)
                  }
                />
                {t('DataConfirmRestore')}
              </label>
              <Button
                disabled={
                  !mutable ||
                  confirmedToken !== preview.token ||
                  preview.blockedByCurrentBarriers ||
                  state.status?.recoveryCopy
                }
                onClick={() => {
                  if (confirmedToken === preview.token) void owner.accept(preview);
                }}
              >
                {t('DataAccept')}
              </Button>
            </div>
          )}
        </DialogPopup>
      </Dialog>
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
          <div className="space-y-4 px-6 pb-6 text-sm">
            <p>{t(deletion === 'recovery' ? 'DataDiscardWarning' : 'DataDeleteWarning')}</p>
            {deletion && deletion !== 'recovery' && <p className="break-all">{deletion.id}</p>}
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {t('DataDeliberate')}
            </label>
          </div>
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
    </Settings.Section>
  );
}
