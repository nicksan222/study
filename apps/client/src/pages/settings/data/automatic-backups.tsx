import { automaticBackupStatusSchema, MAX_AUTOMATIC_BACKUPS } from '@study/contracts';
import type {
  automaticBackupConfigurationSchema,
  backupOAuthInputSchema,
  backupSignInIdSchema
} from '@study/contracts';
import { rpc } from '@study/contracts/react';
import {
  Button,
  DataManagement,
  Input,
  Loading,
  RetryButton,
  SelectControl,
  Settings
} from '@study/ui';
import { Schema } from 'effect';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import type { SignInBrowser } from '#client/lib/host.ts';
import { prepareSignInBrowser } from '#client/lib/host.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import {
  isOAuthProvider,
  isStorageProvider,
  OAuthBackupControls,
  StorageBackupControls
} from './backup-provider-controls.tsx';

type Status = typeof automaticBackupStatusSchema.Type;

type Destination = Status['destination'];

type SignInId = typeof backupSignInIdSchema.Type;

type SignInAttempt = { browser: SignInBrowser; id?: SignInId; cancelling?: boolean };

type Configuration = typeof automaticBackupConfigurationSchema.Type;

type Feedback =
  | 'DataAutoBackupSaveFailed'
  | 'DataAutoBackupRunFailed'
  | 'DataAutoBackupSignInFailed';

const labels = {
  off: 'DataAutoBackupOff',
  local: 'DataAutoBackupLocal',
  folder: 'DataAutoBackupFolder',
  onedrive: 'DataAutoBackupOneDrive',
  'google-drive': 'DataBackupGoogle',
  dropbox: 'DataBackupDropbox',
  s3: 'DataBackupS3',
  webdav: 'DataBackupWebDav',
  'azure-blob': 'DataBackupAzure'
} as const;

const isDestination = Schema.is(automaticBackupStatusSchema.fields.destination);

function useBackupActions() {
  const configure = rpc.system.configureAutomaticBackup.useMutation();
  const run = rpc.system.runAutomaticBackup.useMutation();
  const begin = rpc.system.beginBackupSignIn.useMutation();
  const finish = rpc.system.finishBackupSignIn.useMutation();
  const cancel = rpc.system.cancelBackupSignIn.useMutation();
  const [feedback, setFeedback] = useState<Feedback>();
  const [signIn, setSignIn] = useState<SignInId>();
  const owned = useRef<SignInAttempt>(undefined);
  const cleanup = useEffectEvent(() => {
    const attempt = owned.current;

    owned.current = undefined;
    attempt?.browser.close();

    if (attempt?.id) void cancel.mutateAsync({ id: attempt.id }).catch(() => {});
  });

  useEffect(() => () => cleanup(), []);

  async function connect(input: typeof backupOAuthInputSchema.Type) {
    if (owned.current) return false;

    setFeedback(undefined);
    const attempt: SignInAttempt = { browser: prepareSignInBrowser() };

    owned.current = attempt;

    try {
      const result = await begin.mutateAsync(input);

      attempt.id = result.id;

      if (owned.current !== attempt) {
        await cancel.mutateAsync({ id: result.id });

        return false;
      }

      setSignIn(result.id);

      if (!(await attempt.browser.open(result.url)))
        throw new Error('Sign-in browser did not open');

      if (owned.current !== attempt) return false;

      await finish.mutateAsync({ id: result.id });

      return owned.current === attempt;
    } catch {
      if (owned.current === attempt && !attempt.cancelling)
        setFeedback('DataAutoBackupSignInFailed');

      if (attempt.id) await cancel.mutateAsync({ id: attempt.id }).catch(() => {});

      return false;
    } finally {
      attempt.browser.close();

      if (owned.current === attempt) {
        owned.current = undefined;
        setSignIn(undefined);
      }
    }
  }

  function cancelSignIn() {
    const attempt = owned.current;

    if (!attempt || !signIn || attempt.id !== signIn || attempt.cancelling) return;

    attempt.cancelling = true;

    void cancel
      .mutateAsync({ id: signIn })
      .then(() => {
        if (owned.current !== attempt) return;

        attempt.browser.close();
        owned.current = undefined;
        setSignIn(undefined);
      })
      .catch(() => {
        attempt.cancelling = false;

        if (owned.current === attempt) setFeedback('DataAutoBackupSignInFailed');
      });
  }

  async function save(destination: Configuration) {
    setFeedback(undefined);

    try {
      await configure.mutateAsync(destination);

      return true;
    } catch {
      setFeedback('DataAutoBackupSaveFailed');

      return false;
    }
  }

  function runNow() {
    setFeedback(undefined);
    void run.mutateAsync({}).catch(() => setFeedback('DataAutoBackupRunFailed'));
  }

  return {
    busy: configure.isPending || run.isPending || begin.isPending || finish.isPending || !!signIn,
    cancelling: cancel.isPending,
    connect,
    cancelSignIn,
    feedback,
    runNow,
    save,
    signIn
  };
}

type BackupActions = ReturnType<typeof useBackupActions>;

export function AutomaticBackups({ mutable }: { mutable: boolean }) {
  const { t, number } = useI18n();
  const query = rpc.system.automaticBackup.useQuery({});
  const actions = useBackupActions();

  return (
    <Settings.Section title={t('DataAutoBackupTitle')} busy={actions.busy}>
      <Settings.Intro>
        {t('DataAutoBackupHelp', { count: number(MAX_AUTOMATIC_BACKUPS) })}
      </Settings.Intro>
      {query.isPending && <Loading label={t('LoadingSettings')} />}
      {query.isError && (
        <Settings.Status
          action={
            <RetryButton label={t('Retry')} onClick={() => query.refetch()} variant="outline" />
          }
        >
          {t('DataReadError')}
        </Settings.Status>
      )}
      {query.data && (
        <BackupControls
          status={query.data}
          actions={actions}
          disabled={!mutable || actions.busy || query.stale}
        />
      )}
      <BackupFeedback actions={actions} failure={query.data?.lastFailure} />
    </Settings.Section>
  );
}

function BackupControls({
  status,
  actions,
  disabled
}: {
  status: Status;
  actions: BackupActions;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Destination>();
  const [editing, setEditing] = useState(false);
  const selected = draft ?? status.destination;

  const configuring = status.destination === 'off' || editing;

  function closeEditor() {
    setEditing(false);
    setDraft(undefined);
  }

  async function finish(result: Promise<boolean>) {
    const saved = await result;

    if (saved) closeEditor();

    return saved;
  }

  return (
    <DataManagement.Groups>
      <BackupReceipt
        status={status}
        disabled={disabled}
        runNow={actions.runNow}
        editing={editing}
        onEdit={editing ? closeEditor : () => setEditing(true)}
      />
      {configuring && (
        <Settings.Group>
          <Settings.Row title={t('DataAutoBackupDestination')}>
            <Settings.Actions>
              <SelectControl
                label={t('DataAutoBackupDestination')}
                value={selected}
                options={Object.entries(labels).map(([value, label]) => ({
                  value,
                  label: t(label)
                }))}
                disabled={disabled}
                onValueChange={(value) => {
                  if (isDestination(value)) setDraft(value);
                }}
              />
              <SaveDeviceDestination
                selected={selected}
                current={status.destination}
                disabled={disabled}
                save={(input) => finish(actions.save(input))}
              />
            </Settings.Actions>
          </Settings.Row>
          {selected === 'folder' && (
            <FolderControls
              currentPath={status.destination === 'folder' ? status.path : null}
              disabled={disabled}
              save={(input) => finish(actions.save(input))}
            />
          )}
          {isOAuthProvider(selected) && (
            <OAuthBackupControls
              key={selected}
              kind={selected}
              disabled={disabled}
              connected={status.destination === selected}
              connect={(input) => finish(actions.connect(input))}
            />
          )}
          {isStorageProvider(selected) && (
            <StorageBackupControls
              key={selected}
              kind={selected}
              disabled={disabled}
              save={(input) => finish(actions.save(input))}
            />
          )}
        </Settings.Group>
      )}
    </DataManagement.Groups>
  );
}

function SaveDeviceDestination({
  selected,
  current,
  disabled,
  save
}: {
  selected: Destination;
  current: Destination;
  disabled: boolean;
  save: BackupActions['save'];
}) {
  const { t } = useI18n();

  if (selected === current || (selected !== 'off' && selected !== 'local')) return null;

  return (
    <Button variant="outline" disabled={disabled} onClick={() => void save({ kind: selected })}>
      {t(selected === 'off' ? 'DataAutoBackupTurnOff' : 'DataAutoBackupEnable')}
    </Button>
  );
}

function FolderControls({
  currentPath,
  disabled,
  save
}: {
  currentPath: string | null;
  disabled: boolean;
  save: BackupActions['save'];
}) {
  const { t } = useI18n();
  const [folder, setFolder] = useState<string>();
  const path = folder ?? currentPath ?? '';
  const canSave = !disabled && path.trim().length > 0 && path !== currentPath;

  return (
    <Settings.Row title={t('DataAutoBackupPath')} description={t('DataAutoBackupPathHelp')}>
      <Settings.Form
        onSubmit={(event) => {
          event.preventDefault();

          if (canSave) void save({ kind: 'folder', path });
        }}
      >
        <Input
          aria-label={t('DataAutoBackupPath')}
          value={path}
          maxLength={4096}
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => setFolder(event.target.value)}
        />
        <Button variant="outline" type="submit" disabled={!canSave}>
          {t('Save')}
        </Button>
      </Settings.Form>
    </Settings.Row>
  );
}

function BackupReceipt({
  status,
  disabled,
  runNow,
  editing,
  onEdit
}: {
  status: Status;
  disabled: boolean;
  runNow: () => void;
  editing: boolean;
  onEdit: () => void;
}) {
  const { t, date } = useI18n();

  if (status.destination === 'off') return null;

  const result =
    status.lastSuccessAtMs === null
      ? t('DataAutoBackupWaiting')
      : t('DataAutoBackupLastRun', {
          date: date(status.lastSuccessAtMs / 1000, { dateStyle: 'medium', timeStyle: 'short' })
        });

  return (
    <Settings.Group>
      <Settings.Row
        title={t('DataAutoBackupActive', { destination: t(labels[status.destination]) })}
        description={status.path ? `${result} · ${status.path}` : result}
      >
        <Settings.Actions>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={onEdit}
            aria-expanded={editing}
          >
            {t(editing ? 'Cancel' : 'DataAutoBackupChange')}
          </Button>
          {!editing && (
            <Button size="sm" variant="default" disabled={disabled} onClick={runNow}>
              {t('DataAutoBackupRun')}
            </Button>
          )}
        </Settings.Actions>
      </Settings.Row>
    </Settings.Group>
  );
}

function BackupFeedback({
  actions,
  failure
}: {
  actions: BackupActions;
  failure: Status['lastFailure'] | undefined;
}) {
  const { t } = useI18n();
  const feedback =
    failure === 'auth'
      ? 'DataAutoBackupAuthExpired'
      : (actions.feedback ?? (failure ? 'DataAutoBackupRunFailed' : undefined));

  return (
    <>
      {actions.signIn && (
        <Settings.Status
          action={
            <Button variant="outline" disabled={actions.cancelling} onClick={actions.cancelSignIn}>
              {t('AiSettingsCancelSignIn')}
            </Button>
          }
        >
          {t('DataAutoBackupSignInPending')}
        </Settings.Status>
      )}
      {feedback && <Settings.Status>{t(feedback)}</Settings.Status>}
    </>
  );
}
