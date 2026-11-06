import type { WorkspacePreferences } from '@study/contracts/settings/types';
import type { StaticMessageKey } from '@study/localization';
import { RetryButton } from '@study/ui/action-button';
import { Loading } from '@study/ui/loading';
import { Settings } from '@study/ui/settings';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { useWorkspacePreferenceControls } from '#web/lib/study-client/workspace-preferences.queries.ts';

const PreferenceContext = createContext<ReturnType<typeof useWorkspacePreferenceControls> | null>(
  null
);

function useControls() {
  const model = useContext(PreferenceContext);

  if (!model) throw new Error('Workspace preference controls require their settings section');

  return model;
}

/** Shares persisted state, save feedback, and retry recovery across a settings section. */
function PreferenceSection({
  title,
  description,
  children
}: {
  title: StaticMessageKey;
  description: StaticMessageKey;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const model = useWorkspacePreferenceControls();
  const { query, mutation } = model;

  return (
    <Settings.Section title={t(title)}>
      <Settings.Intro>{t(description)}</Settings.Intro>
      {(query.error || mutation.error) && (
        <Settings.Status
          action={
            <RetryButton
              size="sm"
              variant="outline"
              onClick={() => {
                mutation.reset();
                void query.refetch();
              }}
              label={t('Retry')}
            />
          }
        >
          {t('WorkspaceSettingsFailed')}
        </Settings.Status>
      )}
      {query.isPending && <Loading label={t('LoadingSettings')} layout="panel" />}
      {query.data && (
        <PreferenceContext value={model}>
          <Settings.Group>{children}</Settings.Group>
        </PreferenceContext>
      )}
      {mutation.isSuccess && !mutation.isPending && (
        <Settings.Feedback role="status">{t('WorkspaceSettingsSaved')}</Settings.Feedback>
      )}
    </Settings.Section>
  );
}

type BooleanField =
  | 'spellcheck'
  | 'submitOnEnter'
  | 'autoTitleSessions'
  | 'autoAnswerQuestions'
  | 'sidebarShowDocumentCounts'
  | 'expandDocuments';

/** Saves one switch while preserving unrelated preferences from other windows. */
function PreferenceToggle({
  field,
  title,
  description
}: {
  field: BooleanField;
  title: StaticMessageKey;
  description: StaticMessageKey;
}) {
  const { t } = useI18n();
  const { query, mutation } = useControls();

  return (
    <Settings.ToggleRow
      title={t(title)}
      description={t(description)}
      checked={query.data![field]}
      disabled={mutation.isPending}
      onCheckedChange={(value) => mutation.mutate({ [field]: value })}
    />
  );
}

type NumberField = 'autosaveIntervalSeconds' | 'editorFontSize' | 'readerFontSize';

/** Keeps a rejected numeric draft editable and clears it only after a confirmed save. */
function PreferenceNumber({
  field,
  title,
  description,
  min,
  max
}: {
  field: NumberField;
  title: StaticMessageKey;
  description: StaticMessageKey;
  min: number;
  max: number;
}) {
  const { t } = useI18n();
  const { query, mutation } = useControls();
  const [draft, setDraft] = useState<string>();
  const value = draft ?? String(query.data![field]);
  const number = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(number) && number >= min && number <= max;

  return (
    <Settings.NumberRow
      title={t(title)}
      description={t(description)}
      min={min}
      max={max}
      value={value}
      onValueChange={setDraft}
      disabled={mutation.isPending}
      submitDisabled={!valid || number === query.data![field]}
      error={valid ? undefined : t('WorkspaceNumberValidation')}
      submitLabel={t(mutation.isPending ? 'Saving' : 'Save')}
      onSubmit={() => {
        if (valid) mutation.mutate({ [field]: number }, { onSuccess: () => setDraft(undefined) });
      }}
    />
  );
}

type SelectField =
  | 'defaultExportFormat'
  | 'defaultAiDetail'
  | 'sidebarDensity'
  | 'sidebarTimeFormat';

/** Maps select values through the allowed typed options before saving them. */
function PreferenceSelect<K extends SelectField>({
  field,
  title,
  description,
  options
}: {
  field: K;
  title: StaticMessageKey;
  description: StaticMessageKey;
  options: readonly { value: WorkspacePreferences[K]; label: StaticMessageKey }[];
}) {
  const { t } = useI18n();
  const { query, mutation } = useControls();

  return (
    <Settings.SelectRow
      title={t(title)}
      description={t(description)}
      value={query.data![field]}
      disabled={mutation.isPending}
      options={options.map((item) => ({ value: item.value, label: t(item.label) }))}
      onValueChange={(value) => {
        const option = options.find((item) => item.value === value);

        if (option) mutation.mutate({ [field]: option.value });
      }}
    />
  );
}

export function WritingSettings() {
  return (
    <PreferenceSection title="WorkspaceWritingTitle" description="WorkspaceWritingDescription">
      <PreferenceNumber
        field="autosaveIntervalSeconds"
        title="WorkspaceAutosave"
        description="WorkspaceAutosaveHelp"
        min={1}
        max={30}
      />
      <PreferenceNumber
        field="editorFontSize"
        title="WorkspaceEditorFont"
        description="WorkspaceEditorFontHelp"
        min={14}
        max={24}
      />
      <PreferenceToggle
        field="spellcheck"
        title="WorkspaceSpellcheck"
        description="WorkspaceSpellcheckHelp"
      />
      <PreferenceToggle
        field="submitOnEnter"
        title="WorkspaceEnterCapture"
        description="WorkspaceEnterCaptureHelp"
      />
      <PreferenceToggle
        field="expandDocuments"
        title="WorkspaceExpandDocuments"
        description="WorkspaceExpandDocumentsHelp"
      />
    </PreferenceSection>
  );
}

export function SessionDisplaySettings() {
  return (
    <PreferenceSection title="WorkspaceSidebarTitle" description="WorkspaceSidebarDescription">
      <PreferenceSelect
        field="sidebarDensity"
        title="WorkspaceDensity"
        description="WorkspaceDensityHelp"
        options={[
          { value: 'comfortable', label: 'WorkspaceComfortable' },
          { value: 'compact', label: 'WorkspaceCompact' }
        ]}
      />
      <PreferenceSelect
        field="sidebarTimeFormat"
        title="WorkspaceTimeFormat"
        description="WorkspaceTimeFormatHelp"
        options={[
          { value: 'relative', label: 'WorkspaceRelativeTime' },
          { value: 'absolute', label: 'WorkspaceAbsoluteTime' }
        ]}
      />
      <PreferenceToggle
        field="sidebarShowDocumentCounts"
        title="WorkspaceDocumentCounts"
        description="WorkspaceDocumentCountsHelp"
      />
    </PreferenceSection>
  );
}

export function ReadingSettings() {
  return (
    <PreferenceSection title="WorkspaceReadingTitle" description="WorkspaceReadingDescription">
      <PreferenceNumber
        field="readerFontSize"
        title="WorkspaceReaderFont"
        description="WorkspaceReaderFontHelp"
        min={14}
        max={24}
      />
      <PreferenceSelect
        field="defaultExportFormat"
        title="WorkspaceExportFormat"
        description="WorkspaceExportFormatHelp"
        options={[
          { value: 'markdown', label: 'WorkspaceMarkdown' },
          { value: 'html', label: 'WorkspaceHtml' },
          { value: 'aid_json', label: 'WorkspaceDocumentJson' },
          { value: 'csv', label: 'ExportCsv' }
        ]}
      />
    </PreferenceSection>
  );
}

export function AiWritingSettings() {
  return (
    <PreferenceSection title="WorkspaceAiTitle" description="WorkspaceAiDescription">
      <PreferenceSelect
        field="defaultAiDetail"
        title="WorkspaceAiDetail"
        description="WorkspaceAiDetailHelp"
        options={[
          { value: 'brief', label: 'SessionDetailBrief' },
          { value: 'balanced', label: 'SessionDetailBalanced' },
          { value: 'detailed', label: 'SessionDetailDetailed' }
        ]}
      />
      <PreferenceToggle
        field="autoAnswerQuestions"
        title="WorkspaceAutoAnswerQuestions"
        description="WorkspaceAutoAnswerQuestionsHelp"
      />
      <PreferenceToggle
        field="autoTitleSessions"
        title="WorkspaceAutoTitles"
        description="WorkspaceAutoTitlesHelp"
      />
    </PreferenceSection>
  );
}
