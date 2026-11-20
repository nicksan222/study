import { pageVersionIdSchema } from '@study/contracts';
import type { PageId, PageVersionId, Page, PageVersion } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Schema } from 'effect';
import { useCallback, useState } from 'react';

import { NotePagePanel } from '../note-workspace';
import { DocumentAttachments } from './document-attachments';
import { ImproveDocument } from './improve-document';
import { MakePageCurrent } from './make-page-current';
import { PageVersionStepper } from './page-version-stepper';

export function AuthoredPageReader({
  id,
  initialVersion,
  project
}: {
  id: PageId;
  initialVersion?: string;
  project?: string;
}) {
  return (
    <PageReaderContent
      key={`${id}:${initialVersion ?? ''}`}
      id={id}
      initialVersion={initialVersion}
      project={project}
    />
  );
}

function PageReaderContent({
  id,
  initialVersion,
  project
}: {
  id: PageId;
  initialVersion?: string;
  project?: string;
}) {
  const [selected, setSelected] = useState<PageVersionId | undefined>(() =>
    initialVersion
      ? Schema.decodeUnknownSync(pageVersionIdSchema)(BigInt(initialVersion))
      : undefined
  );

  const current = rpc.pages.get.useQuery({ id });

  if (selected !== undefined && selected === current.data?.headVersionId) setSelected(undefined);

  const [restoring, setRestoring] = useState(false);

  const actions = useCallback(
    (page: Page, version: PageVersion, disabled: boolean) => {
      const projectId = project
        ? page.projectIds.find((id) => String(id) === project)
        : page.projectIds[0];

      return (
        <>
          {projectId && (
            <DocumentAttachments key={String(projectId)} pageId={page.id} projectId={projectId} />
          )}
          {version.id === page.headVersionId && (!project || projectId) && (
            <ImproveDocument
              key={String(projectId)}
              page={page}
              version={version}
              projectId={projectId}
              disabled={disabled || restoring || page.archivedAt !== null}
            />
          )}
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
      );
    },
    [id, project, restoring]
  );

  return <NotePagePanel pageId={id} versionId={selected} actions={actions} />;
}
