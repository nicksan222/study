import type { ProjectId } from '@study/contracts/ids';
import type { transformSnapshotSchema } from '@study/contracts/pages/transform';
import type { PageSummary } from '@study/contracts/pages/types';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import { AiActivity } from '@study/ui/ai-button';
import { Button } from '@study/ui/button';
import { DialogFooter } from '@study/ui/dialog';
import { Input } from '@study/ui/input';
import { PageOverview } from '@study/ui/page-overview';
import { StatusMessage } from '@study/ui/status-message';
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

export function PageMerges({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const state = rpc.pages.merges.useQuery({ projectId: project });
  const items = state.data?.filter((item) => !item.cancelled) ?? [];

  if (!items.length && !state.error) return null;

  return (
    <PageOverview.Section aria-label={t('PagesMergeWork')}>
      <PageOverview.SectionHeading>{t('PagesMergeWork')}</PageOverview.SectionHeading>
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <PageOverview.Picker>
        {items.map((item) => (
          <MergeProgress key={item.id} item={item} project={project} />
        ))}
      </PageOverview.Picker>
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
    <div>
      <PageOverview.Name>{item.title}</PageOverview.Name>
      <MergeProgressOutcome {...{ item, result, project }} />
      <MergeProgressActions
        item={item}
        busy={mutation.isPending}
        run={(action) => void mutation.mutate(action)}
      />
      {mutation.error && <ContentReadError error={mutation.error} />}
      {result.error && <ContentReadError error={result.error} />}
    </div>
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
      {' '}
      {item.resultVersionId === null && !item.errorKind && <AiActivity label={t('PagesMerging')} />}
      {item.errorKind && <StatusMessage>{t(mergeErrorMessage(item.errorKind))}</StatusMessage>}
      {result.data && (
        <Link
          to="/pages/$pageId"
          params={{ pageId: String(result.data.pageId) }}
          search={project ? { project: String(project) } : {}}
        >
          {t('PagesMergeDone')}
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
      {' '}
      {item.resultVersionId === null && (
        <>
          {item.errorKind && (
            <Button variant="outline" disabled={busy} onClick={() => run('retry')}>
              {t('PagesMergeRetry')}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => run('cancel')}>
            {t('PagesMergeCancel')}
          </Button>
        </>
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
