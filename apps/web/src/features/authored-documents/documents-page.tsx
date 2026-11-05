import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { ProjectId } from '@study/contracts/ids';
import { projectIdSchema } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { DocumentOverview } from '@study/ui/document-overview';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { Check, Circle, ArrowUpRight, FileText, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentsOptions } from '#web/lib/study-client/documents.queries.ts';

import { ContentReadError } from '../document-presentation';
import { NewBlankDocument } from './creation-actions';
import { DocumentContextMenu } from './document-context-menu';
import { DocumentsFromSessions } from './from-sessions';
import { DocumentMerges, MergeDocumentsDialog } from './merge';

/** A dedicated destination for completed documents, independent from sources and materials. */
export function DocumentsPage() {
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;
  return <DocumentsOverviewPage key={String(project)} project={project} />;
}

function DocumentsOverviewPage({ project }: { project?: ProjectId }) {
  const { t } = useI18n();
  const [archived, setArchived] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [merging, setMerging] = useState(false);
  const state = useInfiniteQuery({
    ...documentsOptions(project, archived),
    select: (data) => ({
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.headVersionId !== null)
      }))
    })
  });

  const items = state.isError ? [] : (state.data?.pages.flatMap((page) => page.items) ?? []);

  const chosen = items.filter((item) => selected.has(String(item.id)));
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });

  return (
    <DocumentOverview.Root>
      <DocumentOverview.Heading>
        <DocumentOverview.Intro>
          <DocumentOverview.Title>{t('DocumentsOverviewTitle')}</DocumentOverview.Title>
          <DocumentOverview.Description>
            {t('DocumentsOverviewDescription')}
          </DocumentOverview.Description>
        </DocumentOverview.Intro>
        <DocumentOverview.Actions>
          <Button
            variant="outline"
            aria-pressed={archived}
            onClick={() => {
              setArchived(!archived);
              setSelecting(false);
              setSelected(new Set());
            }}
          >
            {t(archived ? 'DocumentsActive' : 'DocumentsArchived')}
          </Button>
          {!archived && (
            <Button
              variant="outline"
              aria-pressed={selecting}
              onClick={() => {
                setSelecting(!selecting);
                setSelected(new Set());
              }}
            >
              {t(selecting ? 'DocumentsCancelSelection' : 'DocumentsSelect')}
            </Button>
          )}
          <NewBlankDocument key={String(project)} project={project} />
          <DocumentsFromSessions key={String(project)} project={project} />
          <Button
            variant="ghost-muted"
            size="icon"
            aria-label={t('LibraryRefresh')}
            title={t('LibraryRefresh')}
            disabled={state.isFetching}
            onClick={() => void state.refetch()}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </DocumentOverview.Actions>
      </DocumentOverview.Heading>
      <DocumentMerges project={project} />
      {selecting && (
        <DocumentOverview.Picker>
          <p>
            {t('DocumentsSelectionHelp')} {t('DocumentsSelected', { count: chosen.length })}
          </p>
          <DocumentOverview.Actions>
            <Button
              variant="outline"
              onClick={() =>
                setSelected(new Set(items.slice(0, 20).map((item) => String(item.id))))
              }
            >
              {t('DocumentsSelectAll')}
            </Button>
            <Button
              disabled={chosen.length < 2 || chosen.length > 20}
              onClick={() => setMerging(true)}
            >
              {t('DocumentsMerge')}
            </Button>
          </DocumentOverview.Actions>
        </DocumentOverview.Picker>
      )}
      {merging && (
        <MergeDocumentsDialog
          documents={chosen}
          project={project}
          onClose={() => {
            setMerging(false);
            setSelecting(false);
            setSelected(new Set());
          }}
        />
      )}
      {state.error && <ContentReadError error={state.error} retry={() => void state.refetch()} />}
      {items.length > 0 && (
        <DocumentOverview.Section aria-label={t('DocumentsSaved')}>
          <DocumentOverview.SectionHeading>
            {t(archived ? 'DocumentsArchived' : 'DocumentsSaved')}
          </DocumentOverview.SectionHeading>
          <DocumentOverview.Rows>
            {items.map((item) => (
              <li key={String(item.id)}>
                {selecting ? (
                  <DocumentOverview.SelectionRow
                    variant="ghost"
                    aria-pressed={selected.has(String(item.id))}
                    disabled={!selected.has(String(item.id)) && selected.size >= 20}
                    onClick={() => toggle(String(item.id))}
                  >
                    <DocumentRowContent item={item} />
                    {selected.has(String(item.id)) ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Circle aria-hidden="true" />
                    )}
                  </DocumentOverview.SelectionRow>
                ) : (
                  <DocumentContextMenu document={item} project={project}>
                    <Link
                      to="/documents/$documentId"
                      params={{ documentId: String(item.id) }}
                      search={project ? { project: String(project) } : {}}
                    >
                      <DocumentRowContent item={item} />
                      <ArrowUpRight aria-hidden="true" />
                    </Link>
                  </DocumentContextMenu>
                )}
              </li>
            ))}
          </DocumentOverview.Rows>
        </DocumentOverview.Section>
      )}
      {state.hasNextPage && (
        <DocumentOverview.Footer>
          <Button
            variant="ghost"
            disabled={state.isFetchingNextPage}
            onClick={() => void state.fetchNextPage()}
          >
            {t('LibraryMore')}
          </Button>
        </DocumentOverview.Footer>
      )}
      {state.isSuccess && !items.length && (
        <DocumentOverview.Empty>
          <FileText aria-hidden="true" />
          <h3>{t('DocumentsEmptyTitle')}</h3>
          <p>{t(archived ? 'DocumentsArchivedEmpty' : 'DocumentsOverviewEmpty')}</p>
        </DocumentOverview.Empty>
      )}
    </DocumentOverview.Root>
  );
}

function DocumentRowContent({ item }: { item: StudyDocumentSummary }) {
  const { t, date } = useI18n();
  return (
    <>
      <DocumentOverview.Icon aria-hidden="true">
        <FileText />
      </DocumentOverview.Icon>
      <DocumentOverview.Copy>
        <DocumentOverview.Name>{item.title}</DocumentOverview.Name>
        {item.description && (
          <DocumentOverview.Preview>{item.description}</DocumentOverview.Preview>
        )}
      </DocumentOverview.Copy>
      <DocumentOverview.Updated>
        <time dateTime={new Date(Number(item.updatedAt) * 1000).toISOString()}>
          {t('SidebarPolishUpdated', {
            date: date(item.updatedAt, { dateStyle: 'medium' })
          })}
        </time>
      </DocumentOverview.Updated>
    </>
  );
}
