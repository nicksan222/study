import { router } from '#backend/runtime/trpc';

import { run as addLink } from './add-link.ts';
import { run as correctBlock } from './correct-block.ts';
import { run as createNote } from './create-note.ts';
import { run as deleteSource } from './delete-source.ts';
import { run as exportSourceToFile } from './export-source-to-file.ts';
import { run as exportSource } from './export-source.ts';
import { run as hasPreview } from './has-preview.ts';
import { run as importFile } from './import-file.ts';
import { run as importFiles } from './import-files.ts';
import { run as preview } from './preview.ts';
import { run as reads } from './reads.ts';
import { run as setSourceProject } from './set-source-project.ts';
import { run as sourceDocument } from './source-document.ts';
import { run as source } from './source.ts';
import { run as sources } from './sources.ts';
import { run as uploadSource } from './upload-source.ts';

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
