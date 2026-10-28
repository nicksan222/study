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

import { importSource as dbImportSource } from '#backend/procedures/sources/operations/import-file';
import { listSources as dbListSources } from '#backend/procedures/sources/operations/sources';
import { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import { readImportFile, readMeasuredFile } from '#backend/shared/sources/file';
import { MAX_SOURCE_BYTES } from '#backend/shared/sources/sniff';
import { createBackendTest } from '#testing/backend-test';

test('reads a single opened file and refuses growth or excessive size', (t) => {
  const testDatabase = createBackendTest(t, { app: false }),
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
  const store = createBackendTest(t, { app: false }).manage(BackendContext.open(testDatabase.path));

  assert.throws(
    () => dbImportSource(store, path),
    (e: unknown) => e instanceof StudyError && e.kind === 'invalid_input'
  );
  assert.equal(dbListSources(store).length, 0);
});
