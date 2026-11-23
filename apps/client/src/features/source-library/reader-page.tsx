import { sourceIdSchema, contentSnapshotIdSchema } from '@study/contracts';
import { MaterialLibrary, WorkspaceSurface } from '@study/ui';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { EditableMaterial } from './inline-source-editor';
import { SourcePanel } from './source-panel';

export function SourcePage() {
  const { sourceId } = useParams({ from: '/sources/$sourceId' });
  const search = useSearch({ from: '__root__' });
  const navigate = useNavigate();
  const uploads = search.fromUploads === '1';
  const id = Schema.decodeUnknownSync(sourceIdSchema)(BigInt(sourceId));

  const panel = (
    <SourcePanel
      key={`${id}:${search.sourceRevision}:${search.sourceSnapshot}`}
      sourceId={id}
      presentation={uploads ? 'materials' : undefined}
      exact={
        search.sourceRevision && search.sourceSnapshot
          ? {
              revision: BigInt(search.sourceRevision),
              snapshotId: Schema.decodeUnknownSync(contentSnapshotIdSchema)(
                BigInt(search.sourceSnapshot)
              )
            }
          : undefined
      }
      onDeleted={() => {
        void navigate({
          to: uploads ? '/uploads' : '/notes',
          search: search.project ? { project: search.project } : {}
        });
      }}
      onOpenPage={(page) => {
        void navigate({
          to: '/practice/study-notes/$pageId',
          params: { pageId: String(page.id) },
          search: { project: search.project }
        });
      }}
    />
  );

  return uploads ? (
    <WorkspaceSurface.Root variant="page">
      <WorkspaceSurface.Content inset="none">
        <EditableMaterial id={id} pinned={!!search.sourceSnapshot}>
          {panel}
        </EditableMaterial>
      </WorkspaceSurface.Content>
    </WorkspaceSurface.Root>
  ) : (
    <MaterialLibrary.Reader>{panel}</MaterialLibrary.Reader>
  );
}
