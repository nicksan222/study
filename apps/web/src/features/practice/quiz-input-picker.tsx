import type { summarySchema } from '@study/contracts/documents/schemas';
import type { ProjectId } from '@study/contracts/ids';
import type { ContentInput } from '@study/contracts/inputs';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Practice } from '@study/ui/practice';
import { Settings } from '@study/ui/settings';
import { SwitchControl } from '@study/ui/switch-control';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentsOptions } from '#web/lib/study-client/documents.queries.ts';

export function QuizInputPicker({
  projectId,
  inputs,
  onChange,
  disabled
}: {
  projectId: ProjectId;
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const documents = useInfiniteQuery(documentsOptions(projectId));
  const rows = documentRows(documents.data);

  return (
    <Practice.SourceInputs>
      <Settings.Section title={t('QuizChooseInputs')}>
        <Settings.Intro>{t('QuizChooseInputsHelp')}</Settings.Intro>
        {documents.isPending && <Loading label={t('LoadingPractice')} layout="panel" />}
        {documents.isError && (
          <ErrorState
            layout="inline"
            title={t('QuizInputsError')}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  void documents.refetch();
                }}
              >
                {t('Retry')}
              </Button>
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
        {documents.hasNextPage && (
          <Button
            variant="ghost"
            disabled={documents.isFetchingNextPage}
            onClick={() => void documents.fetchNextPage()}
          >
            {t('LibraryMore')}
          </Button>
        )}
        {rows.length === 0 && documents.isSuccess && (
          <Settings.Feedback>{t('QuizNoProjectInputs')}</Settings.Feedback>
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
    <Settings.Row title={document.title} description={t('SessionEntryDocument')}>
      <SwitchControl
        label={document.title}
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
    </Settings.Row>
  );
}

function documentRows(
  data: { pages: readonly { items: readonly (typeof summarySchema.Type)[] }[] } | undefined
) {
  return (
    data?.pages.flatMap((page) => page.items).filter((item) => item.headVersionId !== null) ?? []
  );
}
