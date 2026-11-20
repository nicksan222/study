import type { ProjectId, transformSnapshotSchema } from '@study/contracts';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import { PageIcon } from '@study/icons';
import { AiActivity, Button, PageOverview, RetryButton, StatusMessage } from '@study/ui';
import { Link } from '@tanstack/react-router';
import { Effect } from 'effect';

import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { ContentReadError } from '../document-presentation';

export function PageMerges({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const state = rpc.pages.merges.useQuery({ projectId: project, studyNotes: true });
  const items = state.data ?? [];

  if (!items.length && !state.error) return null;

  return (
    <PageOverview.Section aria-label={t('PracticeStudyNotesActivity')}>
      <PageOverview.SectionHeading>{t('PracticeStudyNotesActivity')}</PageOverview.SectionHeading>
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <PageOverview.Rows>
        {items.map((item) => (
          <MergeProgress
            key={item.id}
            item={item}
            project={item.studyNotes?.projectId ?? project}
          />
        ))}
      </PageOverview.Rows>
    </PageOverview.Section>
  );
}

function MergeProgress({
  item,
  project
}: {
  item: typeof transformSnapshotSchema.Type;
  project?: ProjectId;
}) {
  const mutation = useIndependentMutation((action: 'cancel' | 'retry') =>
    Effect.tryPromise({
      try: () =>
        action === 'cancel'
          ? rpc.pages.cancelTransform.call({ requestId: item.id })
          : rpc.pages.retryTransform.call({ requestId: item.id, retryId: crypto.randomUUID() }),
      catch: toStudyError
    })
  );
  const result = rpc.pages.version.useQuery(
    item.resultVersionId === null ? undefined : { id: item.resultVersionId }
  );

  return (
    <PageOverview.Job>
      <PageOverview.Icon>
        <PageIcon aria-hidden="true" />
      </PageOverview.Icon>
      <PageOverview.Copy>
        <PageOverview.Name>{item.title}</PageOverview.Name>
        <MergeProgressOutcome {...{ item, result, project }} />
        {mutation.error && <ContentReadError error={mutation.error} />}
        {result.error && <ContentReadError error={result.error} />}
      </PageOverview.Copy>
      <MergeProgressActions
        item={item}
        busy={mutation.isPending}
        run={(action) => void mutation.mutate(action)}
      />
    </PageOverview.Job>
  );
}

function MergeProgressOutcome({
  item,
  result,
  project
}: {
  item: typeof transformSnapshotSchema.Type;
  result: ReturnType<typeof rpc.pages.version.useQuery>;
  project?: ProjectId;
}) {
  const { t } = useI18n();

  return (
    <>
      {item.resultVersionId === null && !item.errorKind && (
        <AiActivity label={t('PracticeStudyNotesGenerating')} />
      )}
      {item.errorKind && <StatusMessage>{t('PracticeStudyNotesFailed')}</StatusMessage>}
      {result.data && (
        <Link
          to="/practice/study-notes/$pageId"
          params={{ pageId: String(result.data.pageId) }}
          search={project ? { project: String(project) } : {}}
        >
          {t('PracticeOpenStudyNotes')}
        </Link>
      )}
    </>
  );
}

function MergeProgressActions({
  item,
  busy,
  run
}: {
  item: typeof transformSnapshotSchema.Type;
  busy: boolean;
  run: (action: 'cancel' | 'retry') => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {item.resultVersionId === null && (
        <PageOverview.Actions>
          {item.errorKind && (
            <RetryButton
              variant="outline"
              disabled={busy}
              label={t('Retry')}
              onClick={() => run('retry')}
            />
          )}
          <Button variant="ghost" disabled={busy} onClick={() => run('cancel')}>
            {t('Cancel')}
          </Button>
        </PageOverview.Actions>
      )}
    </>
  );
}
