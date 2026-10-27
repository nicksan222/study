import { router } from '#backend/runtime/trpc';

import { run as artifact } from './artifact.ts';
import { run as canUpdateMaterial } from './can-update-material.ts';
import { run as deleteArtifact } from './delete-artifact.ts';
import { run as deleteMaterial } from './delete-material.ts';
import { run as materialChanges } from './material-changes.ts';
import { run as material } from './material.ts';
import { run as setCard } from './set-card.ts';
import { run as updateMaterial } from './update-material.ts';

export const materialRouter = router({
  updateMaterial,
  canUpdateMaterial,
  materialChanges,
  deleteMaterial,
  material,
  artifact,
  setCard,
  deleteArtifact
});
