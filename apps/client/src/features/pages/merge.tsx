import type { ProjectId } from '@study/contracts/ids';
import type { transformSnapshotSchema } from '@study/contracts/pages/transform';
import type { PageSummary } from '@study/contracts/pages/types';
import { AiActivity } from '@study/ui/ai-button';
import { Button } from '@study/ui/button';
import { DialogFooter } from '@study/ui/dialog';
import { Input } from '@study/ui/input';
import { PageOverview } from '@study/ui/page-overview';
import { StatusMessage } from '@study/ui/status-message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { pageVersionOptions, invalidatePages } from '#client/lib/study-client/pages.queries.ts';

import { ContentReadError } from '../document-presentation';
import { pageMergesOptions, mergePagesOptions, mergeActionOptions } from './merge.queries';
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
  const cache = useQueryClient();
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    ...mergePagesOptions(),
    onSuccess: async () => {
      await invalidatePages(cache);
      onClose();
    }
  });

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
            mutation.mutate({
              key,
              title: title.trim(),
              instruction,
              versions: pages.map((doc) => doc.headVersionId!),
              projectId: project,
              language: locale
            })
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
  const cache = useQueryClient();
  const state = useQuery(pageMergesOptions(project));
  const completed = useRef(new Set<string>());

  useEffect(() => {
    const fresh =
      state.data?.filter(
        (item) => item.resultVersionId !== null && !completed.current.has(item.id)
      ) ?? [];

    for (const item of fresh) completed.current.add(item.id);

    if (fresh.length) void invalidatePages(cache);
  }, [state.data, cache]);
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
  const { t } = useI18n();
  const cache = useQueryClient();
  const mutation = useMutation({
    ...mergeActionOptions(item.id),
    onSuccess: () => invalidatePages(cache)
  });
  const result = useQuery({
    ...pageVersionOptions(item.resultVersionId!),
    enabled: item.resultVersionId !== null
  });

  return (
    <div>
      <PageOverview.Name>{item.title}</PageOverview.Name>
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
      {item.resultVersionId === null && (
        <>
          {item.errorKind && (
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate('retry')}
            >
              {t('PagesMergeRetry')}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate('cancel')}
          >
            {t('PagesMergeCancel')}
          </Button>
        </>
      )}
      {mutation.error && <ContentReadError error={mutation.error} />}
      {result.error && <ContentReadError error={result.error} />}
    </div>
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
