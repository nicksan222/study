import type { MaterialId } from '@study/contracts/ids';
import type { ProjectId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import { LoadMoreButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { useParams, useSearch } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { useCursorRecovery } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';
import type { Subjects } from '#client/lib/study-client/types.ts';

import { LibraryListView } from './library-list.view';
import { libraryItems } from './library.logic';

export function LibraryList({
  subjects,
  project,
  blocked,
  ready,
  query
}: {
  subjects: Subjects;
  project?: ProjectId;
  blocked: boolean;
  ready: boolean;
  query: string;
}) {
  const { t } = useI18n();
  const params = useParams({ strict: false });
  const search = useSearch({ from: '__root__' });
  const scope = String(project ?? 'global');
  const [pagination, setPagination] = useState<{ scope: string; cursors: MaterialId[] }>({
    scope,
    cursors: []
  });
  const cursors = pagination.scope === scope ? pagination.cursors : [];
  const result = rpc.materials.list.useQuery(
    { projectId: project, archived: false, limit: 100, cursor: cursors.at(-1) },
    { enabled: !blocked && ready }
  );
  const reset = useCallback(() => setPagination({ scope, cursors: [] }), [scope]);

  useCursorRecovery({ cursor: cursors.at(-1), reset }, result.error);
  const state = result.isError
    ? { status: 'error' as const, error: result.error }
    : result.data
      ? { status: 'success' as const, data: libraryItems(result.data.items, project) }
      : { status: 'pending' as const };

  return (
    <>
      {cursors.length > 0 && (
        <Button
          variant="ghost-muted"
          onClick={() => setPagination({ scope, cursors: cursors.slice(0, -1) })}
        >
          {t('Back')}
        </Button>
      )}
      {result.data?.nextCursor && (
        <LoadMoreButton
          variant="ghost-muted"
          label={t('LibraryMore')}
          onClick={() => {
            if (result.data?.nextCursor)
              setPagination({ scope, cursors: [...cursors, result.data.nextCursor] });
          }}
        />
      )}

      <LibraryListView
        {...{ state, subjects, blocked, query, search }}
        selectedMaterial={params.materialId}
        reload={() => {
          result.retry();
        }}
      />
    </>
  );
}
