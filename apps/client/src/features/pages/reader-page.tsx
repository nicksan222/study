import { pageIdSchema } from '@study/contracts/ids';
import { WorkspaceDeskSurface as Desk } from '@study/ui/workspace-desk';
import { useParams, useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

import { AuthoredPageReader } from './reader';

export function PageReaderPage() {
  const { pageId } = useParams({ from: '/pages/$pageId' });
  const search = useSearch({ from: '__root__' });
  const id = Schema.decodeUnknownSync(pageIdSchema)(BigInt(pageId));

  return (
    <Desk.PageReaderPage>
      <AuthoredPageReader key={String(id)} id={id} initialVersion={search.pageVersion} />
    </Desk.PageReaderPage>
  );
}
