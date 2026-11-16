import { Db } from '@study/db';
import { projects } from '@study/db';

const path = process.argv[2];

if (!path) throw new Error('Missing database path');

// A new server process validates persisted infrastructure before opening its writable connection.
await Db.validateInfrastructure(path);

const db = await Db.open(path);

try {
  await Bun.write(
    Bun.stdout,
    JSON.stringify(db.orm.select({ name: projects.name }).from(projects).all())
  );
} finally {
  db.close();
}
