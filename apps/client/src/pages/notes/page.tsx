import { PagesPage } from '#client/features/pages/index.ts';

import { PageView } from './page.view';
import { useNotebookDraft, usePage } from './use-page';

export function Page() {
  return <PageView {...usePage()} />;
}

export function DocumentsIndex() {
  return useNotebookDraft() ? <Page /> : <PagesPage />;
}
