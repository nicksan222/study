import type {
  integrationImportSchema,
  integrationWarningSchema
} from '@study/contracts/integrations/schemas';
import type { StaticMessageKey } from '@study/localization';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Disclosure } from '@study/ui/disclosure';
import { ErrorState } from '@study/ui/error-state';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';
import { Link } from '@tanstack/react-router';
import { Upload } from 'lucide-react';
import { useRef } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useIntegrations } from './use-integrations';

type Model = ReturnType<typeof useIntegrations>;

type Run = typeof integrationImportSchema.Type;

const statuses = {
  preview: 'IntegrationPreview',
  running: 'IntegrationRunning',
  completed: 'IntegrationCompleted',
  cancelled: 'IntegrationCancelled',
  failed: 'IntegrationFailed',
  pending: 'IntegrationPending',
  imported: 'IntegrationImported',
  unchanged: 'IntegrationUnchanged',
  conflict: 'IntegrationConflict',
  excluded: 'IntegrationExcluded'
} as const satisfies Record<Run['status'] | Run['items'][number]['status'], StaticMessageKey>;

const warnings = {
  empty_note: 'IntegrationEmptyNote',
  oversized_note: 'IntegrationOversizedNote',
  missing_link: 'IntegrationMissingLink',
  ambiguous_link: 'IntegrationAmbiguousLink',
  missing_attachment: 'IntegrationMissingAttachment',
  embedded_note: 'IntegrationEmbeddedNote',
  unsupported_file: 'IntegrationUnsupportedFile'
} as const satisfies Record<typeof integrationWarningSchema.Type.code, StaticMessageKey>;

export function IntegrationsSettings() {
  const model = useIntegrations();
  const { t } = useI18n();

  return (
    <>
      <ImportControls model={model} />
      {(model.imports.isPending || model.providers.isPending) && (
        <Loading label={t('LoadingSettings')} layout="panel" />
      )}
      {[model.imports, model.providers, model.projects, model.preview, model.action].some(
        (query) => query.isError
      ) && (
        <ErrorState
          title={t('IntegrationError')}
          action={
            <RetryButton
              label={t('Retry')}
              onClick={() => {
                void model.imports.refetch();
                void model.providers.refetch();
                void model.projects.refetch();
                model.preview.reset();
                model.action.reset();
              }}
            />
          }
        />
      )}
      {model.current && <ImportDetail model={model} run={model.current} />}
      <ImportHistory model={model} />
    </>
  );
}

function ImportHistory({ model }: { model: Model }) {
  const { t } = useI18n();

  return (
    <Settings.Section title={t('IntegrationHistory')}>
      <Settings.Group>
        {model.imports.data?.map((run) => (
          <Settings.Item
            key={run.id}
            icon={<Upload aria-hidden="true" />}
            label={run.sourceKey}
            description={t(statuses[run.status])}
            onClick={() => {
              model.setSelected(run.id);
              model.setExcluded(
                run.items.filter((item) => item.status === 'excluded').map((item) => item.key)
              );
            }}
          />
        ))}
      </Settings.Group>
      {model.imports.data?.length === 0 && (
        <Settings.Empty>{t('IntegrationHistoryEmpty')}</Settings.Empty>
      )}
    </Settings.Section>
  );
}

function ImportControls({ model }: { model: Model }) {
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement>(null);
  const providers =
    model.providers.data?.filter((provider) => provider.capabilities.includes('import')) ?? [];

  return (
    <Settings.Section title={t('IntegrationsTitle')}>
      <Settings.Intro>{t('IntegrationIntro')}</Settings.Intro>
      <Settings.Group>
        <Settings.SelectRow
          title={t('IntegrationProvider')}
          value={model.providerId}
          options={providers.map((provider) => ({
            value: provider.id,
            label: provider.id === 'obsidian' ? t('IntegrationObsidian') : provider.id
          }))}
          disabled={model.busy}
          onValueChange={model.setProviderId}
        />
        <Settings.Row title={t('IntegrationVaultName')} description={t('IntegrationIdentityHelp')}>
          <Input
            aria-label={t('IntegrationVaultName')}
            value={model.sourceKey}
            maxLength={200}
            disabled={model.busy}
            onChange={(event) => model.setSourceKey(event.target.value)}
          />
        </Settings.Row>
        <Settings.Row title={t('IntegrationVaultFolder')} description={t('IntegrationLimit')}>
          <input
            ref={(element) => {
              picker.current = element;
              element?.setAttribute('webkitdirectory', '');
            }}
            hidden
            type="file"
            multiple
            tabIndex={-1}
            aria-label={t('IntegrationChooseVault')}
            disabled={model.busy}
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])];

              event.currentTarget.value = '';

              if (files.length) model.previewFiles(files);
            }}
          />
          <Button
            variant="outline"
            disabled={model.busy || !providers.length}
            onClick={() => picker.current?.click()}
          >
            {t(model.preview.isPending ? 'IntegrationScanning' : 'IntegrationChooseVault')}
          </Button>
        </Settings.Row>
      </Settings.Group>
    </Settings.Section>
  );
}

function ImportDetail({ model, run }: { model: Model; run: Run }) {
  const { t } = useI18n();
  const preview = run.status === 'preview';
  const selected = run.items.length - model.excluded.length;
  const imported = run.items.filter(
    (item) => item.status === 'imported' || item.status === 'unchanged'
  ).length;
  const total = preview ? selected : run.items.filter((item) => item.status !== 'excluded').length;

  return (
    <Settings.Section title={run.sourceKey}>
      <Settings.Feedback role="status" aria-live="polite">
        {t('IntegrationProgress', { completed: imported, total })} · {t(statuses[run.status])}
      </Settings.Feedback>
      {preview && (
        <Settings.SelectRow
          title={t('IntegrationDestination')}
          value={model.project}
          options={[
            { value: 'none', label: t('IntegrationNoProject') },
            ...(model.projects.data ?? []).map((project) => ({
              value: String(project.id),
              label: project.name
            }))
          ]}
          disabled={model.busy}
          onValueChange={model.setProject}
        />
      )}
      {run.status === 'cancelled' && run.attempt > 0 && (
        <Settings.Intro>{t('IntegrationCancelHelp')}</Settings.Intro>
      )}
      {run.items.some((item) => item.status === 'conflict') && (
        <Settings.Intro>{t('IntegrationConflictHelp')}</Settings.Intro>
      )}
      <ImportItems model={model} run={run} />
      <ImportWarnings run={run} />
      <ImportActions model={model} run={run} selected={selected} />
    </Settings.Section>
  );
}

function ImportItems({ model, run }: { model: Model; run: Run }) {
  const { t } = useI18n();
  const preview = run.status === 'preview';

  return (
    <Settings.Group>
      {run.items.map((item) =>
        preview ? (
          <Settings.ToggleRow
            key={item.key}
            title={item.title}
            description={item.key}
            checked={!model.excluded.includes(item.key)}
            disabled={model.busy}
            onCheckedChange={(checked) =>
              model.setExcluded(
                checked
                  ? model.excluded.filter((key) => key !== item.key)
                  : [...model.excluded, item.key]
              )
            }
          />
        ) : (
          <Settings.Row
            key={item.key}
            title={item.title}
            description={`${item.key} · ${t(statuses[item.status])}`}
          >
            {item.sessionId && (
              <Link to="/session/$sessionId" params={{ sessionId: item.sessionId }}>
                {t('IntegrationOpenSession')}
              </Link>
            )}
          </Settings.Row>
        )
      )}
    </Settings.Group>
  );
}

function ImportWarnings({ run }: { run: Run }) {
  const { t } = useI18n();

  if (!run.warnings.length) return null;

  return (
    <Disclosure summary={t('IntegrationWarnings', { count: run.warnings.length })}>
      <Settings.Group>
        {uniqueWarnings(run).map((warning) => (
          <Settings.Row
            key={`${warning.path}:${warning.code}:${warning.target}`}
            title={t(warnings[warning.code])}
            description={[warning.path, warning.target].filter(Boolean).join(' · ')}
          >
            {null}
          </Settings.Row>
        ))}
      </Settings.Group>
    </Disclosure>
  );
}

function ImportActions({ model, run, selected }: { model: Model; run: Run; selected: number }) {
  const { t } = useI18n();
  const preview = run.status === 'preview';

  return (
    <Settings.Actions>
      {preview && (
        <Button
          disabled={model.busy || !selected || model.projects.isPending}
          onClick={() => model.act(run, 'start')}
        >
          {t('IntegrationStart', { count: selected })}
        </Button>
      )}
      {(preview || run.status === 'running') && (
        <Button variant="outline" disabled={model.busy} onClick={() => model.act(run, 'cancel')}>
          {t('Cancel')}
        </Button>
      )}
      {run.status === 'failed' && (
        <ErrorState
          title={t('IntegrationFailed')}
          action={
            <RetryButton
              label={t('Retry')}
              disabled={model.busy}
              onClick={() => model.act(run, 'retry')}
            />
          }
        />
      )}
      {run.status === 'cancelled' && run.attempt > 0 && (
        <Button variant="outline" disabled={model.busy} onClick={() => model.act(run, 'retry')}>
          {t('IntegrationResume')}
        </Button>
      )}
    </Settings.Actions>
  );
}

function uniqueWarnings(run: Run) {
  return [...new Map(run.warnings.map((warning) => [JSON.stringify(warning), warning])).values()];
}
