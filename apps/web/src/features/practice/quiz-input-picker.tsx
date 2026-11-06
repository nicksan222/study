import type { summarySchema } from '@study/contracts/documents/schemas';
import type { ContentInput } from '@study/contracts/inputs';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Practice } from '@study/ui/practice';
import { Settings } from '@study/ui/settings';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

export function QuizInputPicker({
  documents,
  inputs,
  onChange,
  disabled
}: {
  documents: UseQueryResult<(typeof summarySchema.Type)[]>;
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const rows = documents.data ?? [];

  return (
    <Practice.SourceInputs>
      <Settings.Section title={t('QuizChooseInputs')}>
        <Settings.Intro>{t('QuizChooseInputsHelp')}</Settings.Intro>
        <Practice.DocumentChoices>
          {documents.isPending && <Loading label={t('LoadingPractice')} layout="panel" />}
          {documents.isError && (
            <ErrorState
              layout="inline"
              title={t('QuizInputsError')}
              action={
                <RetryButton
                  variant="outline"
                  onClick={() => {
                    void documents.refetch();
                  }}
                  label={t('Retry')}
                />
              }
            />
          )}
          <Settings.Group>
            {rows.map((document) => (
              <DocumentInput
                key={String(document.id)}
                document={document}
                inputs={inputs}
                onChange={onChange}
                disabled={disabled}
              />
            ))}
          </Settings.Group>
          {rows.length === 0 && documents.isSuccess && (
            <Settings.Feedback>{t('QuizNoProjectInputs')}</Settings.Feedback>
          )}
        </Practice.DocumentChoices>
        {documents.isSuccess && rows.length > 0 && (
          <Practice.SetupActions>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                onChange(
                  rows.flatMap((doc) =>
                    doc.headVersionId
                      ? [{ kind: 'document' as const, versionId: doc.headVersionId }]
                      : []
                  )
                )
              }
            >
              {t('SelectAll')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || inputs.length === 0}
              onClick={() => onChange([])}
            >
              {t('PracticeClearSelection')}
            </Button>
            <Practice.MutedText>
              {inputs.length} / {rows.length}
            </Practice.MutedText>
          </Practice.SetupActions>
        )}
      </Settings.Section>
    </Practice.SourceInputs>
  );
}

function DocumentInput({
  document,
  inputs,
  onChange,
  disabled
}: {
  document: typeof summarySchema.Type;
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const selected = inputs.some(
    (input) => input.kind === 'document' && input.versionId === document.headVersionId
  );

  return (
    <Settings.ToggleRow
      title={document.title}
      description={t('SessionEntryDocument')}
      checked={selected}
      disabled={disabled || (!selected && inputs.length >= 20)}
      onCheckedChange={(checked) => {
        const versionId = document.headVersionId;

        if (!versionId) return;

        onChange((current) => {
          if (!checked)
            return current.filter(
              (input) => input.kind !== 'document' || input.versionId !== versionId
            );

          return current.length >= 20 ? current : [...current, { kind: 'document', versionId }];
        });
      }}
    />
  );
}
