import type { ContentInput } from '@study/contracts/inputs';
import type { summarySchema } from '@study/contracts/pages/schemas';
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
  pages,
  inputs,
  onChange,
  disabled
}: {
  pages: UseQueryResult<(typeof summarySchema.Type)[]>;
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const rows = pages.data ?? [];

  return (
    <Practice.SourceInputs>
      <Settings.Section title={t('QuizChooseInputs')}>
        <Settings.Intro>{t('QuizChooseInputsHelp')}</Settings.Intro>
        <Practice.PageChoices>
          {pages.isPending && <Loading label={t('LoadingPractice')} layout="panel" />}
          {pages.isError && (
            <ErrorState
              layout="inline"
              title={t('QuizInputsError')}
              action={
                <RetryButton
                  variant="outline"
                  onClick={() => {
                    void pages.refetch();
                  }}
                  label={t('Retry')}
                />
              }
            />
          )}
          <Settings.Group>
            {rows.map((page) => (
              <PageInput
                key={String(page.id)}
                page={page}
                inputs={inputs}
                onChange={onChange}
                disabled={disabled}
              />
            ))}
          </Settings.Group>
          {rows.length === 0 && pages.isSuccess && (
            <Settings.Feedback>{t('QuizNoProjectInputs')}</Settings.Feedback>
          )}
        </Practice.PageChoices>
        {pages.isSuccess && rows.length > 0 && (
          <Practice.SetupActions>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                onChange(
                  rows.flatMap((doc) =>
                    doc.headVersionId
                      ? [{ kind: 'page' as const, versionId: doc.headVersionId }]
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

function PageInput({
  page,
  inputs,
  onChange,
  disabled
}: {
  page: typeof summarySchema.Type;
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const selected = inputs.some(
    (input) => input.kind === 'page' && input.versionId === page.headVersionId
  );

  return (
    <Settings.ToggleRow
      title={page.title}
      description={t('NoteEntryPage')}
      checked={selected}
      disabled={disabled || (!selected && inputs.length >= 20)}
      onCheckedChange={(checked) => {
        const versionId = page.headVersionId;

        if (!versionId) return;

        onChange((current) => {
          if (!checked)
            return current.filter(
              (input) => input.kind !== 'page' || input.versionId !== versionId
            );

          return current.length >= 20 ? current : [...current, { kind: 'page', versionId }];
        });
      }}
    />
  );
}
