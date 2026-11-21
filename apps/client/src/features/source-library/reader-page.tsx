import { sourceIdSchema, contentSnapshotIdSchema } from '@study/contracts';
import { MaterialLibrary } from '@study/ui';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { EditableMaterial } from './inline-source-editor';
import { SourcePanel } from './source-panel';

export function SourcePage() {
  const { sourceId } = useParams({ from: '/sources/$sourceId' });
  const search = useSearch({ from: '__root__' });
  const navigate = useNavigate();
  const uploads = search.fromUploads && search.project ? search.project : undefined;
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
          to: '/pages/$pageId',
          params: { pageId: String(page.id) }
        });
      }}
    />
  );

  return uploads ? (
    <EditableMaterial id={id} pinned={!!search.sourceSnapshot}>
      {panel}
    </EditableMaterial>
  ) : (
    <MaterialLibrary.Reader>{panel}</MaterialLibrary.Reader>
  );
}
