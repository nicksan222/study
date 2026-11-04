import { sourceIdSchema, contentSnapshotIdSchema } from '@study/contracts/ids';
import { MaterialLibrary } from '@study/ui/material-library';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Schema } from 'effect';

import { SourcePanel } from '../features/source-library/source-panel';

export const Route = createFileRoute('/sources/$sourceId')({
  staticData: { title: 'AnswerSources', section: 'library', scope: 'global' },
  beforeLoad: ({ params }) => {
    Schema.decodeUnknownSync(sourceIdSchema)(BigInt(params.sourceId));
  },
  component: SourcePage
});
function SourcePage() {
  const { sourceId } = Route.useParams();
  const search = Route.useSearch();
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
            to: '/library',
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
