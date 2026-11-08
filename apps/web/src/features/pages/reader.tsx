import type { PageId, PageVersionId } from '@study/contracts/ids';
import { pageVersionIdSchema } from '@study/contracts/ids';
import type { Page, PageVersion } from '@study/contracts/pages/types';
import { useQuery } from '@tanstack/react-query';
import { Schema } from 'effect';
import { useCallback, useState } from 'react';

import { notePageOptions, NotePagePanel } from '../note-workspace';
import { MakePageCurrent } from './make-page-current';
import { PageVersionStepper } from './page-version-stepper';

export function AuthoredPageReader({
  id,
  initialVersion
}: {
  id: PageId;
  initialVersion?: string;
}) {
  return (
    <DocumentReader key={`${id}:${initialVersion ?? ''}`} id={id} initialVersion={initialVersion} />
  );
}

function DocumentReader({ id, initialVersion }: { id: PageId; initialVersion?: string }) {
  const [selected, setSelected] = useState<PageVersionId | undefined>(() =>
    initialVersion
      ? Schema.decodeUnknownSync(pageVersionIdSchema)(BigInt(initialVersion))
      : undefined
  );

  const current = useQuery(notePageOptions(id));

  if (selected !== undefined && selected === current.data?.headVersionId) setSelected(undefined);

  const [restoring, setRestoring] = useState(false);

  const actions = useCallback(
    (document: Page, version: PageVersion, disabled: boolean) => (
      <>
        <PageVersionStepper
          pageId={id}
          version={version}
          headVersionId={document.headVersionId}
          onChange={setSelected}
          pending={disabled || restoring}
        />
        {version.id !== document.headVersionId && (
          <MakePageCurrent
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

  return <NotePagePanel pageId={id} versionId={selected} actions={actions} />;
}
