import type { transformSnapshotSchema } from '@study/contracts/documents/transform';
import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { ProjectId } from '@study/contracts/ids';
import { AiActivity } from '@study/ui/ai-button';
import { Button } from '@study/ui/button';
import { DialogFooter } from '@study/ui/dialog';
import { DocumentOverview } from '@study/ui/document-overview';
import { Input } from '@study/ui/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import {
  documentVersionOptions,
  invalidateDocuments
} from '#web/lib/study-client/documents.queries.ts';

import { ContentReadError } from '../document-presentation';
import { DocumentActionDialog } from './document-action-dialog';
import { documentMergesOptions, mergeDocumentsOptions, mergeActionOptions } from './merge.queries';

export function MergeDocumentsDialog({
  documents,
  project,
  onClose
}: {
  documents: StudyDocumentSummary[];
  project?: ProjectId;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const cache = useQueryClient();
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    ...mergeDocumentsOptions(),
    onSuccess: async () => {
      await invalidateDocuments(cache);
      onClose();
    }
  });

  return (
    <DocumentActionDialog
      pending={mutation.isPending}
      onClose={onClose}
      title={t('DocumentsMerge')}
      description={t('DocumentsMergeHelp')}
    >
      <DocumentOverview.Picker>
        <ul>
          {documents.map((doc) => (
            <li key={String(doc.id)}>{doc.title}</li>
          ))}
        </ul>
        <Input
          aria-label={t('DocumentsMergeTitle')}
          placeholder={t('DocumentsMergeTitle')}
          value={title}
          onValueChange={(value) => {
            setTitle(value);
            setKey(crypto.randomUUID());
          }}
          maxLength={200}
          disabled={mutation.isPending}
        />
        <Input
          aria-label={t('DocumentsMergeInstruction')}
          placeholder={t('DocumentsMergeInstruction')}
          value={instruction}
          onValueChange={(value) => {
            setInstruction(value);
            setKey(crypto.randomUUID());
          }}
          maxLength={10000}
          disabled={mutation.isPending}
        />
        {mutation.error && <ContentReadError error={mutation.error} />}
      </DocumentOverview.Picker>
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
              versions: documents.map((doc) => doc.headVersionId!),
              projectId: project,
              language: locale
            })
          }
        >
          {t('DocumentsMerge')}
        </Button>
      </DialogFooter>
    </DocumentActionDialog>
  );
}

export function DocumentMerges({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const state = useQuery(documentMergesOptions(project));
  const completed = useRef(new Set<string>());

  useEffect(() => {
    const fresh =
      state.data?.filter(
        (item) => item.resultVersionId !== null && !completed.current.has(item.id)
      ) ?? [];

    for (const item of fresh) completed.current.add(item.id);

    if (fresh.length) void invalidateDocuments(cache);
  }, [state.data, cache]);
  const items = state.data?.filter((item) => !item.cancelled) ?? [];

  if (!items.length && !state.error) return null;

  return (
    <DocumentOverview.Section aria-label={t('DocumentsMergeWork')}>
      <DocumentOverview.SectionHeading>{t('DocumentsMergeWork')}</DocumentOverview.SectionHeading>
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      <DocumentOverview.Picker>
        {items.map((item) => (
          <MergeProgress key={item.id} item={item} project={project} />
        ))}
      </DocumentOverview.Picker>
    </DocumentOverview.Section>
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
    onSuccess: () => invalidateDocuments(cache)
  });
  const result = useQuery({
    ...documentVersionOptions(item.resultVersionId!),
    enabled: item.resultVersionId !== null
  });

  return (
    <div>
      <DocumentOverview.Name>{item.title}</DocumentOverview.Name>
      {item.resultVersionId === null && !item.errorKind && (
        <AiActivity label={t('DocumentsMerging')} />
      )}
      {item.errorKind && <p role="status">{t(mergeErrorMessage(item.errorKind))}</p>}
      {result.data && (
        <Link
          to="/documents/$documentId"
          params={{ documentId: String(result.data.documentId) }}
          search={project ? { project: String(project) } : {}}
        >
          {t('DocumentsMergeDone')}
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
              {t('DocumentsMergeRetry')}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate('cancel')}
          >
            {t('DocumentsMergeCancel')}
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
      return 'DocumentsMergeSetup';
    case 'invalid_input':
    case 'not_found':
      return 'DocumentsMergeInputsChanged';
    default:
      return 'DocumentsMergeFailed';
  }
}
