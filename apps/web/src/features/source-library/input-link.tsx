import type { selectionReferenceSchema } from '@study/contracts/conversations/context';
import type { StudyDocumentVersionId } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { documentVersionOptions } from '#web/lib/study-client/documents.queries.ts';

/** Opens precisely the cited retained version or source extraction, never a current head. */
export function CapturedInputLink({
  input,
  name
}: {
  input: typeof selectionReferenceSchema.Type;
  name: string;
}) {
  return input.kind === 'source' ? (
    <Link
      to="/sources/$sourceId"
      params={{ sourceId: String(input.sourceId) }}
      search={{ sourceRevision: String(input.revision), sourceSnapshot: String(input.snapshotId) }}
    >
      {name}
    </Link>
  ) : (
    <AuthoredInputLink versionId={input.versionId} name={name} />
  );
}
function AuthoredInputLink({
  versionId,
  name
}: {
  versionId: StudyDocumentVersionId;
  name: string;
}) {
  const state = useQuery(documentVersionOptions(versionId));
  return state.data && !state.error ? (
    <Link
      to="/documents/$documentId"
      params={{ documentId: String(state.data.documentId) }}
      search={{ documentVersion: String(versionId) }}
    >
      {name}
    </Link>
  ) : (
    <span>{name}</span>
  );
}
