import { sourceIdSchema, contentSnapshotIdSchema } from '@study/contracts';
import { Button, MaterialLibrary } from '@study/ui';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { useI18n } from '#client/lib/i18n.tsx';

import { ProcessingRetry } from './processing-retry';
import { SourcePanel } from './source-panel';

export function SourcePage() {
  const { sourceId } = useParams({ from: '/sources/$sourceId' });
  const search = useSearch({ from: '__root__' });
  const navigate = useNavigate();
  const { t } = useI18n();
  const uploads = search.fromUploads && search.project ? search.project : undefined;
  const id = Schema.decodeUnknownSync(sourceIdSchema)(BigInt(sourceId));

  return (
    <MaterialLibrary.Reader>
      {uploads && (
        <div>
          <Button variant="ghost" render={<Link to="/uploads" search={{ project: uploads }} />}>
            {t('UploadedMaterialsBack')}
          </Button>
          <ProcessingRetry key={String(id)} id={id} />
        </div>
      )}
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
    </MaterialLibrary.Reader>
  );
}
