import { router } from '#backend/runtime/trpc';

import { run as archive } from './archive/index.ts';
import { run as attach } from './attach/index.ts';
import { run as createVersion } from './create-version/index.ts';
import { run as create } from './create/index.ts';
import { run as deleteDraft } from './delete-draft/index.ts';
import { run as detach } from './detach/index.ts';
import { run as getCitations } from './get-citations/index.ts';
import { run as getDependents } from './get-dependents/index.ts';
import { run as getInputs } from './get-inputs/index.ts';
import { run as getVersion } from './get-version/index.ts';
import { run as get } from './get/index.ts';
import { run as listVersions } from './list-versions/index.ts';
import { run as list } from './list/index.ts';
import { run as publishVersion } from './publish-version/index.ts';
import { run as rename } from './rename/index.ts';
import { run as reorder } from './reorder/index.ts';
import { run as replaceDraft } from './replace-draft/index.ts';
import { run as setCitations } from './set-citations/index.ts';
import { run as unarchive } from './unarchive/index.ts';

export const materialsRouter = router({
  create,
  get,
  list,
  rename,
  archive,
  unarchive,
  attach,
  detach,
  reorder,
  createVersion,
  getVersion,
  listVersions,
  replaceDraft,
  publishVersion,
  deleteDraft,
  getInputs,
  getDependents,
  getCitations,
  setCitations
});
