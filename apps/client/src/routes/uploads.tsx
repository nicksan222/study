import { createFileRoute } from '@tanstack/react-router';

import { UploadedMaterialsPage } from '../features/source-library';

export const Route = createFileRoute('/uploads')({
  staticData: { title: 'UploadedMaterials', section: 'uploads', scope: 'project' },
  component: UploadedMaterialsPage
});
