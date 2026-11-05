import { createFileRoute } from '@tanstack/react-router';

import { DocumentsPage } from '../features/authored-documents';

export const Route = createFileRoute('/documents/')({
  staticData: { title: 'SourceDocument', section: 'documents', scope: 'project' },
  component: DocumentsPage
});
