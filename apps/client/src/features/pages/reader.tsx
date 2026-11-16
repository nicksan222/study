import { pageVersionIdSchema } from '@study/contracts';
import type { PageId, PageVersionId, Page, PageVersion } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Schema } from 'effect';
import { useCallback, useState } from 'react';

import { NotePagePanel } from '../note-workspace';
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
    <PageReaderContent
      key={`${id}:${initialVersion ?? ''}`}
      id={id}
      initialVersion={initialVersion}
    />
  );
}

function PageReaderContent({ id, initialVersion }: { id: PageId; initialVersion?: string }) {
  const [selected, setSelected] = useState<PageVersionId | undefined>(() =>
    initialVersion
      ? Schema.decodeUnknownSync(pageVersionIdSchema)(BigInt(initialVersion))
      : undefined
  );

  const current = rpc.pages.get.useQuery({ id });

  if (selected !== undefined && selected === current.data?.headVersionId) setSelected(undefined);

  const [restoring, setRestoring] = useState(false);

  const actions = useCallback(
    (page: Page, version: PageVersion, disabled: boolean) => (
      <>
        <PageVersionStepper
          pageId={id}
          version={version}
          headVersionId={page.headVersionId}
          onChange={setSelected}
          pending={disabled || restoring}
        />
        {version.id !== page.headVersionId && (
          <MakePageCurrent
            key={String(version.id)}
            onBusy={setRestoring}
            page={page}
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
