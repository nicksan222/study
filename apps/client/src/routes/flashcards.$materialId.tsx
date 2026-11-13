import { createFileRoute } from '@tanstack/react-router';

import {
  materialSidebar,
  validateMaterialParams,
  materialLoaderDeps,
  loadMaterial
} from '../app/shell/practice-loaders';
import { MaterialRouteError } from '../features/material-library';
import { FlashcardsMaterialPage } from '../features/practice';

export const Route = createFileRoute('/flashcards/$materialId')({
  staticData: {
    header: 'workspace',
    title: 'Flashcards',
    section: 'practice',
    scope: 'project',
    sidebar: materialSidebar
  },
  beforeLoad: validateMaterialParams,
  loaderDeps: materialLoaderDeps,
  loader: loadMaterial,
  errorComponent: MaterialRouteError,
  component: FlashcardsMaterialPage
});
