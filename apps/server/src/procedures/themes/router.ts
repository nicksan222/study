import { router } from '#server/runtime/trpc';

import { run as deleteTheme } from './delete/index.ts';
import { run as exportTheme } from './export/index.ts';
import { run as importTheme } from './import/index.ts';
import { run as list } from './list/index.ts';
import { run as save } from './save/index.ts';
import { run as select } from './select/index.ts';
import { run as selected } from './selected/index.ts';

export const themesRouter = router({
  list,
  import: importTheme,
  save,
  export: exportTheme,
  delete: deleteTheme,
  selected,
  select
});
