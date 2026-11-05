import type { StudyDocument, StudyDocumentVersion } from '@study/contracts/documents/types';
import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { Schema } from 'effect';
import { useCallback, useState } from 'react';

import { sessionDocumentOptions, SessionDocumentPanel } from '../session-workspace';
import { DocumentVersionStepper } from './document-version-stepper';
import { MakeDocumentCurrent } from './make-document-current';

export function AuthoredDocumentReader({
  id,
  initialVersion
}: {
  id: StudyDocumentId;
  initialVersion?: string;
}) {
  return (
    <DocumentReader key={`${id}:${initialVersion ?? ''}`} id={id} initialVersion={initialVersion} />
  );
}

function DocumentReader({ id, initialVersion }: { id: StudyDocumentId; initialVersion?: string }) {
  const [selected, setSelected] = useState<StudyDocumentVersionId | undefined>(() =>
    initialVersion
      ? Schema.decodeUnknownSync(studyDocumentVersionIdSchema)(BigInt(initialVersion))
      : undefined
  );

  const current = useQuery(sessionDocumentOptions(id));

  if (selected !== undefined && selected === current.data?.headVersionId) setSelected(undefined);

  const [restoring, setRestoring] = useState(false);

  const actions = useCallback(
    (document: StudyDocument, version: StudyDocumentVersion, disabled: boolean) => (
      <>
        <DocumentVersionStepper
          documentId={id}
          version={version}
          headVersionId={document.headVersionId}
          onChange={setSelected}
          pending={disabled || restoring}
        />
        {version.id !== document.headVersionId && (
          <MakeDocumentCurrent
            key={String(version.id)}
            onBusy={setRestoring}
            document={document}
            version={version}
            disabled={disabled}
            onRestored={() => setSelected(undefined)}
          />
        )}
      </>
    ),
    [id, restoring]
  );

  return <SessionDocumentPanel documentId={id} versionId={selected} actions={actions} />;
}
