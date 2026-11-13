import { createFileRoute } from '@tanstack/react-router';

import {
  materialSidebar,
  validateMaterialParams,
  materialLoaderDeps,
  loadMaterial
} from '../app/shell/practice-loaders';
import { MaterialRouteError } from '../features/material-library';
import { QuizMaterialPage } from '../features/practice';

export const Route = createFileRoute('/practice/$materialId')({
  staticData: {
    header: 'workspace',
    title: 'Practice',
    section: 'practice',
    scope: 'project',
    sidebar: materialSidebar
  },
  beforeLoad: validateMaterialParams,
  loaderDeps: materialLoaderDeps,
  loader: loadMaterial,
  errorComponent: MaterialRouteError,
  component: QuizMaterialPage
});
