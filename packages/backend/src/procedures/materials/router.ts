import { router } from '#backend/runtime/trpc';

import { run as archive } from './archive.ts';
import { run as attach } from './attach.ts';
import { run as createVersion } from './create-version.ts';
import { run as create } from './create.ts';
import { run as deleteDraft } from './delete-draft.ts';
import { run as detach } from './detach.ts';
import { run as getCitations } from './get-citations.ts';
import { run as getDependents } from './get-dependents.ts';
import { run as getInputs } from './get-inputs.ts';
import { run as getVersion } from './get-version.ts';
import { run as get } from './get.ts';
import { run as listVersions } from './list-versions.ts';
import { run as list } from './list.ts';
import { run as publishVersion } from './publish-version.ts';
import { run as rename } from './rename.ts';
import { run as reorder } from './reorder.ts';
import { run as replaceDraft } from './replace-draft.ts';
import { run as setCitations } from './set-citations.ts';
import { run as unarchive } from './unarchive.ts';

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
