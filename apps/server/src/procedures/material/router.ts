import { router } from '#server/runtime/trpc';

import { run as artifact } from './artifact/index.ts';
import { run as canUpdateMaterial } from './can-update-material/index.ts';
import { run as deleteArtifact } from './delete-artifact/index.ts';
import { run as deleteMaterial } from './delete-material/index.ts';
import { run as materialChanges } from './material-changes/index.ts';
import { run as material } from './material/index.ts';
import { run as setCard } from './set-card/index.ts';
import { run as updateMaterial } from './update-material/index.ts';

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
