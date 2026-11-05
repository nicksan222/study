import { projectIdSchema } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { MaterialLibrary } from '@study/ui/material-library';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { useI18n } from '#web/lib/i18n.tsx';
import { documentsOptions } from '#web/lib/study-client/documents.queries.ts';

import { NewDocument } from '../document-editing';
import { AuthoredLibrary } from './library';

/** A dedicated destination for completed documents, independent from sources and materials. */
export function DocumentsPage() {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });
  const project = search.project
    ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(search.project))
    : undefined;
  const state = useInfiniteQuery({
    ...documentsOptions(project),
    select: (data) => ({
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => item.headVersionId !== null)
      }))
    })
  });
  return (
    <MaterialLibrary.Root>
      <MaterialLibrary.Heading>
        <MaterialLibrary.FocusHeading>{t('SourceDocument')}</MaterialLibrary.FocusHeading>
        <MaterialLibrary.Actions>
          <NewDocument />
          <Button variant="ghost" disabled={state.isFetching} onClick={() => void state.refetch()}>
            {t('LibraryRefresh')}
          </Button>
        </MaterialLibrary.Actions>
      </MaterialLibrary.Heading>
      <AuthoredLibrary state={state} project={project} />
      {state.isSuccess && state.data.pages.every((page) => page.items.length === 0) && (
        <MaterialLibrary.Empty>
          <p>{t('DocumentsEmpty')}</p>
        </MaterialLibrary.Empty>
      )}
    </MaterialLibrary.Root>
  );
}
