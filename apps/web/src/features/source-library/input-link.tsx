import type { selectionReferenceSchema } from '@study/contracts/conversations/context';
import type { StudyDocumentVersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { documentVersionOptions } from '#web/lib/study-client/documents.queries.ts';

/** Opens precisely the cited retained version or source extraction, never a current head. */

export function CapturedInputLink({
  input,
  name,
  action = false
}: {
  input: typeof selectionReferenceSchema.Type;
  name: string;
  action?: boolean;
}) {
  return input.kind === 'source' ? (
    <InputLinkPresentation
      action={action}
      name={name}
      link={
        <Link
          to="/sources/$sourceId"
          params={{ sourceId: String(input.sourceId) }}
          search={{
            sourceRevision: String(input.revision),
            sourceSnapshot: String(input.snapshotId)
          }}
        >
          {name}
        </Link>
      }
    />
  ) : (
    <AuthoredInputLink versionId={input.versionId} name={name} action={action} />
  );
}

function AuthoredInputLink({
  versionId,
  name,
  action
}: {
  versionId: StudyDocumentVersionId;
  name: string;
  action: boolean;
}) {
  const state = useQuery(documentVersionOptions(versionId));

  return state.data && !state.error ? (
    <InputLinkPresentation
      action={action}
      name={name}
      link={
        <Link
          to="/documents/$documentId"
          params={{ documentId: String(state.data.documentId) }}
          search={{ documentVersion: String(versionId) }}
        >
          {name}
        </Link>
      }
    />
  ) : action ? (
    <Button size="sm" variant="outline" disabled>
      {name}
    </Button>
  ) : (
    <span>{name}</span>
  );
}

function InputLinkPresentation({
  action,
  name,
  link
}: {
  action: boolean;
  name: string;
  link: ReactElement;
}) {
  return action ? (
    <Button size="sm" variant="outline" render={link}>
      {name}
    </Button>
  ) : (
    link
  );
}
