import { studyDocumentIdSchema } from '@study/contracts/ids';
import { useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { AuthoredDocumentReader } from './reader';

export function DocumentPage() {
  const { documentId } = useParams({ from: '/documents/$documentId' });
  const search = useSearch({ from: '__root__' });
  const id = Schema.decodeUnknownSync(studyDocumentIdSchema)(BigInt(documentId));

  return (
    <AuthoredDocumentReader
      key={`${id}:${search.documentVersion ?? 'current'}`}
      id={id}
      initialVersion={search.documentVersion}
    />
  );
}
