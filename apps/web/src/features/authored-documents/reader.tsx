import type { StudyDocumentId, StudyDocumentVersionId } from '@study/contracts/ids';
import { studyDocumentVersionIdSchema } from '@study/contracts/ids';
import { useQuery } from '@tanstack/react-query';
import { Schema } from 'effect';
import { useEffect, useState } from 'react';

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
  const [selected, setSelected] = useState<StudyDocumentVersionId | undefined>(() =>
    initialVersion
      ? Schema.decodeUnknownSync(studyDocumentVersionIdSchema)(BigInt(initialVersion))
      : undefined
  );

  useEffect(() => {
    setSelected(
      initialVersion
        ? Schema.decodeUnknownSync(studyDocumentVersionIdSchema)(BigInt(initialVersion))
        : undefined
    );
  }, [initialVersion]);
  const current = useQuery(sessionDocumentOptions(id));
  useEffect(() => {
    if (selected !== undefined && selected === current.data?.headVersionId) setSelected(undefined);
  }, [selected, current.data?.headVersionId]);

  const [restoring, setRestoring] = useState(false);

  return (
    <SessionDocumentPanel
      documentId={id}
      versionId={selected}
      actions={(document, version, disabled) => (
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
      )}
    />
  );
}
