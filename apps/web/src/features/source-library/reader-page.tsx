import { sourceIdSchema, contentSnapshotIdSchema } from '@study/contracts/ids';
import { MaterialLibrary } from '@study/ui/material-library';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { SourcePanel } from './source-panel';

export function SourcePage() {
  const { sourceId } = useParams({ from: '/sources/$sourceId' });
  const search = useSearch({ from: '__root__' });
  const navigate = useNavigate();
  const id = Schema.decodeUnknownSync(sourceIdSchema)(BigInt(sourceId));

  return (
    <MaterialLibrary.Reader>
      <SourcePanel
        key={`${id}:${search.sourceRevision}:${search.sourceSnapshot}`}
        sourceId={id}
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
            to: '/sessions',
            search: search.project ? { project: search.project } : {}
          });
        }}
        onOpenDocument={(document) => {
          void navigate({
            to: '/documents/$documentId',
            params: { documentId: String(document.id) }
          });
        }}
      />
    </MaterialLibrary.Reader>
  );
}
