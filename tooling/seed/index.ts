import { parseArgs } from 'node:util';

import { text } from '@study/localization';

import { developmentDatabasePath } from '../development/database-path.ts';

const { values } = parseArgs({
  options: { help: { type: 'boolean' } },
  strict: true,
  allowPositionals: false
});

if (values.help) {
  console.info(text('english', 'SeedHelp'));
} else {
  const { seedDatabase } = await import('./seed.ts');
  const path = developmentDatabasePath();

  console.info(text('english', 'SeedResetting', { path }));

  const summary = await seedDatabase(path);

  console.info(text('english', 'SeedComplete', summary));
}
