import { createFileRoute } from '@tanstack/react-router';

import {
  DocumentsPage,
  documentsRouteDeps,
  documentsRouteLoader
} from '../features/authored-documents';

export const Route = createFileRoute('/documents/')({
  staticData: { title: 'SourceDocument', section: 'documents', scope: 'project' },
  loaderDeps: documentsRouteDeps,
  loader: documentsRouteLoader,
  component: DocumentsPage
});
