import type { PageId, ContentInput, summarySchema } from '@study/contracts';
import type { rpc } from '@study/contracts/react';
import { RetryButton, Button, ErrorState, Loading, Practice, Settings } from '@study/ui';
import type { Dispatch, SetStateAction } from 'react';

import type { useCursorWindow } from '#client/lib/cursor-window.tsx';
import { CursorWindowActions } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

export function QuizInputPicker({
  pages,
  inputs,
  onChange,
  disabled
}: {
  pages: ReturnType<typeof rpc.pages.list.useQuery> & {
    pagination: ReturnType<typeof useCursorWindow<PageId>>;
  };
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const rows = pages.data?.items ?? [];

  return (
    <Settings.Section title={t('SourcePage')}>
      <CursorWindowActions
        {...pages.pagination}
        more={() => pages.pagination.more(pages.data?.nextCursor)}
        hasMore={!!pages.data?.nextCursor}
        pending={pages.isFetching}
      />
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
        <InputSelectionActions
          rows={rows}
          inputs={inputs}
          onChange={onChange}
          disabled={disabled}
        />
      )}
    </Settings.Section>
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

function InputSelectionActions({
  rows,
  inputs,
  onChange,
  disabled
}: {
  rows: readonly (typeof summarySchema.Type)[];
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <Practice.SetupActions>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() =>
          onChange((current) => {
            const additional = current.filter((item) => item.kind !== 'page');
            const pages = rows.flatMap((doc) =>
              doc.headVersionId ? [{ kind: 'page' as const, versionId: doc.headVersionId }] : []
            );

            return [...additional, ...pages.slice(0, 20 - additional.length)];
          })
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
      <Practice.MutedText>{inputs.length} / 20</Practice.MutedText>
    </Practice.SetupActions>
  );
}
