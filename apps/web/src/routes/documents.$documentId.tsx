import { studyDocumentIdSchema } from '@study/contracts/ids';
import { createFileRoute } from '@tanstack/react-router';
import { Schema } from 'effect';

import { AuthoredDocumentReader } from '../features/authored-documents/reader';

export const Route = createFileRoute('/documents/$documentId')({
  staticData: { title: 'SourceDocument', section: 'library', scope: 'global' },
  beforeLoad: ({ params }) => {
    Schema.decodeUnknownSync(studyDocumentIdSchema)(BigInt(params.documentId));
  },
  component: DocumentPage
});
function DocumentPage() {
  const { documentId } = Route.useParams();
  const search = Route.useSearch();
  const id = Schema.decodeUnknownSync(studyDocumentIdSchema)(BigInt(documentId));
  return (
    <AuthoredDocumentReader
      key={`${id}:${search.documentVersion ?? 'current'}`}
      id={id}
      initialVersion={search.documentVersion}
    />
  );
}
