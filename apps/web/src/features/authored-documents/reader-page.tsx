import type { StudyDocument } from '@study/contracts/documents/types';
import { studyDocumentIdSchema } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { SessionDeskSurface as Desk } from '@study/ui/session-desk';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';
import { History } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { SessionDocumentPanel } from '../session-workspace';
import { AuthoredDocumentReader } from './reader';

export function DocumentPage() {
  const { documentId } = useParams({ from: '/documents/$documentId' });
  const search = useSearch({ from: '__root__' });
  const id = Schema.decodeUnknownSync(studyDocumentIdSchema)(BigInt(documentId));

  if (!search.documentVersion) {
    return (
      <Desk.DocumentPage>
        <SessionDocumentPanel key={String(id)} documentId={id} actions={renderDocumentActions} />
      </Desk.DocumentPage>
    );
  }

  return (
    <AuthoredDocumentReader
      key={`${id}:${search.documentVersion ?? 'current'}`}
      id={id}
      initialVersion={search.documentVersion}
    />
  );
}

function renderDocumentActions(document: StudyDocument) {
  return <DocumentHistoryLink document={document} />;
}

function DocumentHistoryLink({ document }: { document: StudyDocument }) {
  const { t } = useI18n();
  const { project } = useSearch({ from: '__root__' });

  if (!document.headVersionId) return null;

  return (
    <Button
      variant="ghost-muted"
      size="icon-sm"
      aria-label={t('ReaderHistory')}
      title={t('ReaderHistory')}
      render={
        <Link
          to="/documents/$documentId"
          params={{ documentId: String(document.id) }}
          search={{ project, documentVersion: String(document.headVersionId) }}
        />
      }
    >
      <History aria-hidden="true" />
    </Button>
  );
}
