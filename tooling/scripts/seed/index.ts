import { text } from '@study/localization';

import { developmentDatabasePath } from '../development/database-path.ts';

const args = Bun.argv.slice(2);

if (args.some((arg) => arg !== '--help')) throw new Error('Unknown seed option');

if (args.includes('--help')) {
  console.info(text('english', 'SeedHelp'));
} else {
  const { seedDatabase } = await import('./seed.ts');
  const path = developmentDatabasePath();

  console.info(text('english', 'SeedResetting', { path }));

  const summary = await seedDatabase(path);

  console.info(text('english', 'SeedComplete', summary));
}
