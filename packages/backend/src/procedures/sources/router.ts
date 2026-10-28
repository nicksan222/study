import { router } from '#backend/runtime/trpc';

import { run as addLink } from './add-link/index.ts';
import { run as correctBlock } from './correct-block/index.ts';
import { run as createNote } from './create-note/index.ts';
import { run as deleteSource } from './delete-source/index.ts';
import { run as exportSourceToFile } from './export-source-to-file/index.ts';
import { run as exportSource } from './export-source/index.ts';
import { run as hasPreview } from './has-preview/index.ts';
import { run as importFile } from './import-file/index.ts';
import { run as importFiles } from './import-files/index.ts';
import { run as preview } from './preview/index.ts';
import { run as reads } from './reads/index.ts';
import { run as setSourceProject } from './set-source-project/index.ts';
import { run as sourceDocument } from './source-document/index.ts';
import { run as source } from './source/index.ts';
import { run as sources } from './sources/index.ts';
import { run as uploadSource } from './upload-source/index.ts';

export const sourcesRouter = router({
  exportSourceToFile,
  sources,
  source,
  importFile,
  importFiles,
  uploadSource,
  createNote,
  addLink,
  sourceDocument,
  correctBlock,
  setSourceProject,
  deleteSource,
  exportSource,
  preview,
  hasPreview,
  reads
});
