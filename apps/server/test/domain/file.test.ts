import assert from 'node:assert/strict';
import {
  openSync,
  closeSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  ftruncateSync
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { importSource as dbImportSource } from '#server/procedures/sources/operations/import-file';
import { listSources as dbListSources } from '#server/procedures/sources/operations/sources';
import { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import { readImportFile, readMeasuredFile } from '#server/shared/sources/file';
import { MAX_SOURCE_BYTES } from '#server/shared/sources/sniff';
import { createServerTest } from '#testing/server-test';

test('reads a single opened file and refuses growth or excessive size', (t) => {
  const testDatabase = createServerTest(t, { app: false }),
    dir = testDatabase.dir;
  const path = join(dir, 'file');

  writeFileSync(path, 'abc');
  let fd = openSync(path, 'r');

  appendFileSync(path, 'd');
  assert.throws(
    () => readMeasuredFile(fd, 3),
    (e: unknown) => e instanceof StudyError && e.kind === 'invalid_input'
  );
  closeSync(fd);
  writeFileSync(path, 'old');
  fd = openSync(path, 'r');
  renameSync(path, join(dir, 'old'));
  writeFileSync(path, 'replacement');
  assert.equal(readImportFile(fd).toString(), 'old');
  closeSync(fd);
  const huge = openSync(path, 'w');

  ftruncateSync(huge, MAX_SOURCE_BYTES + 1);
  closeSync(huge);
  const store = createServerTest(t, { app: false }).manage(ServerContext.open(testDatabase.path));

  assert.throws(
    () => dbImportSource(store, path),
    (e: unknown) => e instanceof StudyError && e.kind === 'invalid_input'
  );
  assert.equal(dbListSources(store).length, 0);
});
