import { backupOAuthInputSchema, storageBackupDestinationSchema } from '@study/contracts';
import type { StaticMessageKey } from '@study/localization';
import { Button, Input, Settings } from '@study/ui';
import { Schema } from 'effect';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

type StorageDestination = typeof storageBackupDestinationSchema.Type;

type OAuthInput = typeof backupOAuthInputSchema.Type;

type Field = {
  name: string;
  label: StaticMessageKey;
  type?: 'password' | 'url';
  hint?: StaticMessageKey;
  optional?: boolean;
  defaultValue?: string;
};

const storageFields = {
  s3: [
    { name: 'bucket', label: 'DataBackupBucket', hint: 'DataBackupBucketHelp' },
    { name: 'region', label: 'DataBackupRegion', defaultValue: 'us-east-1' },
    {
      name: 'endpoint',
      label: 'DataBackupEndpoint',
      type: 'url',
      optional: true,
      hint: 'DataBackupS3EndpointHelp'
    },
    { name: 'prefix', label: 'DataBackupPrefix', optional: true },
    { name: 'accessKeyId', label: 'DataBackupAccessKey' },
    { name: 'secretAccessKey', label: 'DataBackupSecretKey', type: 'password' }
  ],
  webdav: [
    { name: 'url', label: 'DataBackupFolderUrl', type: 'url', hint: 'DataBackupWebDavHelp' },
    { name: 'username', label: 'DataBackupUsername' },
    { name: 'password', label: 'DataBackupAppPassword', type: 'password' }
  ],
  'azure-blob': [
    { name: 'url', label: 'DataBackupContainerUrl', type: 'url', hint: 'DataBackupAzureHelp' },
    { name: 'prefix', label: 'DataBackupPrefix', optional: true },
    { name: 'sas', label: 'DataBackupSas', type: 'password' }
  ]
} as const satisfies Record<StorageDestination['kind'], readonly Field[]>;

const oauthFields = {
  onedrive: [
    { name: 'clientId', label: 'DataAutoBackupClientId', hint: 'DataAutoBackupClientIdHelp' }
  ],
  'google-drive': [
    { name: 'clientId', label: 'DataAutoBackupClientId', hint: 'DataBackupGoogleHelp' },
    { name: 'clientSecret', label: 'DataBackupClientSecret', type: 'password' }
  ],
  dropbox: [{ name: 'clientId', label: 'DataBackupDropboxKey', hint: 'DataBackupDropboxHelp' }]
} as const satisfies Record<OAuthInput['kind'], readonly Field[]>;

const isStorage = Schema.is(storageBackupDestinationSchema);

const isOAuth = Schema.is(backupOAuthInputSchema);

export function isStorageProvider(kind: string): kind is StorageDestination['kind'] {
  return Object.hasOwn(storageFields, kind);
}

export function isOAuthProvider(kind: string): kind is OAuthInput['kind'] {
  return Object.hasOwn(oauthFields, kind);
}

function ProviderForm({
  fields,
  disabled,
  action,
  onSubmit
}: {
  fields: readonly Field[];
  disabled: boolean;
  action: StaticMessageKey;
  onSubmit: (values: Record<string, FormDataEntryValue>) => Promise<boolean> | undefined;
}) {
  const { t } = useI18n();
  const [invalid, setInvalid] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries([...new FormData(form)].filter(([, value]) => value !== ''));
    const result = onSubmit(values);

    setInvalid(result === undefined);

    if (result)
      void result.then((saved) => {
        if (saved) form.reset();
      });
  }

  return (
    <form onSubmit={submit} onChange={() => setInvalid(false)}>
      {fields.map((field) => (
        <Settings.Row
          key={field.name}
          title={t(field.label)}
          description={field.hint && t(field.hint)}
        >
          <Input
            name={field.name}
            type={field.type ?? 'text'}
            aria-label={t(field.label)}
            autoComplete={field.type === 'password' ? 'new-password' : 'off'}
            spellCheck={false}
            required={!field.optional}
            defaultValue={field.defaultValue}
            maxLength={4096}
            disabled={disabled}
          />
        </Settings.Row>
      ))}
      <Settings.Row title={t('DataBackupConnection')}>
        <Button type="submit" variant="outline" disabled={disabled}>
          {t(action)}
        </Button>
      </Settings.Row>
      {invalid && <Settings.Status>{t('DataBackupInvalidConfig')}</Settings.Status>}
    </form>
  );
}

export function StorageBackupControls({
  kind,
  disabled,
  save
}: {
  kind: StorageDestination['kind'];
  disabled: boolean;
  save: (destination: StorageDestination) => Promise<boolean>;
}) {
  return (
    <ProviderForm
      fields={storageFields[kind]}
      disabled={disabled}
      action="Save"
      onSubmit={(fields) => {
        const input = { kind, ...fields };

        return isStorage(input) ? save(input) : undefined;
      }}
    />
  );
}

function oauthAction(kind: OAuthInput['kind'], connected: boolean) {
  if (kind === 'onedrive') return connected ? 'DataAutoBackupReconnect' : 'DataAutoBackupConnect';

  return connected ? 'DataBackupReconnect' : 'DataBackupConnect';
}

export function OAuthBackupControls({
  kind,
  connected,
  disabled,
  connect
}: {
  kind: OAuthInput['kind'];
  connected: boolean;
  disabled: boolean;
  connect: (input: OAuthInput) => Promise<boolean>;
}) {
  return (
    <ProviderForm
      fields={oauthFields[kind]}
      disabled={disabled}
      action={oauthAction(kind, connected)}
      onSubmit={(fields) => {
        const input = { kind, ...fields };

        return isOAuth(input) ? connect(input) : undefined;
      }}
    />
  );
}
