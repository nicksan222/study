import { studyDocumentIdSchema } from '@study/contracts/ids';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { AuthoredDocumentReader } from './reader';

export function DocumentPage() {
  const { documentId } = useParams({ from: '/documents/$documentId' });
  const search = useSearch({ from: '__root__' });
  const id = Schema.decodeUnknownSync(studyDocumentIdSchema)(BigInt(documentId));

  return (
    <Desk.DocumentPage>
      <AuthoredDocumentReader key={String(id)} id={id} initialVersion={search.documentVersion} />
    </Desk.DocumentPage>
  );
}
