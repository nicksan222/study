import type { ProjectId, transformSnapshotSchema, PageSummary } from '@study/contracts';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import { PageIcon } from '@study/icons';
import { AiActivity, Button, DialogFooter, Input, PageOverview, StatusMessage } from '@study/ui';
import { Link } from '@tanstack/react-router';
import { Effect } from 'effect';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { ContentReadError } from '../document-presentation';
import { PageActionDialog } from './page-action-dialog';

export function MergePagesDialog({
  pages,
  project,
  onClose
}: {
  pages: PageSummary[];
  project?: ProjectId;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const mutation = rpc.pages.merge.useMutation();

  return (
    <PageActionDialog
      pending={mutation.isPending}
      onClose={onClose}
      title={t('PagesMerge')}
      description={t('PagesMergeHelp')}
    >
      <PageOverview.Picker>
        <ul>
          {pages.map((doc) => (
            <li key={String(doc.id)}>{doc.title}</li>
          ))}
        </ul>
        <Input
          aria-label={t('PagesMergeTitle')}
          placeholder={t('PagesMergeTitle')}
          value={title}
          onValueChange={(value) => {
            setTitle(value);
            setKey(crypto.randomUUID());
          }}
          maxLength={200}
          disabled={mutation.isPending}
        />
        <Input
          aria-label={t('PagesMergeInstruction')}
          placeholder={t('PagesMergeInstruction')}
          value={instruction}
          onValueChange={(value) => {
            setInstruction(value);
            setKey(crypto.randomUUID());
          }}
          maxLength={10000}
          disabled={mutation.isPending}
        />
        {mutation.error && <ContentReadError error={mutation.error} />}
      </PageOverview.Picker>
      <DialogFooter>
        <Button variant="outline" disabled={mutation.isPending} onClick={onClose}>
          {t('Close')}
        </Button>
        <Button
          disabled={!title.trim() || mutation.isPending}
          onClick={() =>
            void mutation
              .mutate({
                key,
                title: title.trim(),
                instruction,
                versions: pages.flatMap((doc) =>
                  doc.headVersionId === null ? [] : [doc.headVersionId]
                ),
                projectId: project,
                language: locale
              })
              .then(onClose)
          }
        >
          {t('PagesMerge')}
        </Button>
      </DialogFooter>
    </PageActionDialog>
  );
}

export function PageMerges({
  project,
  studyNotes = false
}: {
  project?: ProjectId;
  studyNotes?: boolean;
}) {
  const { t } = useI18n();
  const state = rpc.pages.merges.useQuery({ projectId: project, studyNotes });
  const items = state.data ?? [];

  if (!items.length && !state.error) return null;

  const itemsList = (
    <PageOverview.Rows>
      {items.map((item) => (
        <MergeProgress key={item.id} item={item} project={project} />
      ))}
    </PageOverview.Rows>
  );
  const error = state.error && (
    <ContentReadError error={state.error} retry={() => void state.refetch()} />
  );

  return studyNotes ? (
    <PageOverview.Work>
      <PageOverview.Heading>
        <PageOverview.Intro>
          <PageOverview.Title>{t('PracticeStudyNotesTitle')}</PageOverview.Title>
        </PageOverview.Intro>
      </PageOverview.Heading>
      {error}
      {itemsList}
    </PageOverview.Work>
  ) : (
    <PageOverview.Section aria-label={t('PagesMergeWork')}>
      <PageOverview.SectionHeading>{t('PagesMergeWork')}</PageOverview.SectionHeading>
      {error}
      {itemsList}
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
        <AiActivity label={t(item.studyNotes ? 'PracticeStudyNotesGenerating' : 'PagesMerging')} />
      )}
      {item.errorKind && (
        <StatusMessage>
          {t(item.studyNotes ? 'PracticeStudyNotesFailed' : mergeErrorMessage(item.errorKind))}
        </StatusMessage>
      )}
      {result.data && (
        <Link
          to="/pages/$pageId"
          params={{ pageId: String(result.data.pageId) }}
          search={project ? { project: String(project) } : {}}
        >
          {t(item.studyNotes ? 'PracticeOpenStudyNotes' : 'PagesMergeDone')}
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
            <Button variant="outline" disabled={busy} onClick={() => run('retry')}>
              {t(item.studyNotes ? 'Retry' : 'PagesMergeRetry')}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => run('cancel')}>
            {t(item.studyNotes ? 'Cancel' : 'PagesMergeCancel')}
          </Button>
        </PageOverview.Actions>
      )}
    </>
  );
}

function mergeErrorMessage(kind: NonNullable<typeof transformSnapshotSchema.Type.errorKind>) {
  switch (kind) {
    case 'auth':
    case 'config':
    case 'model_unavailable':
      return 'PagesMergeSetup';
    case 'invalid_input':
    case 'not_found':
      return 'PagesMergeInputsChanged';
    default:
      return 'PagesMergeFailed';
  }
}
