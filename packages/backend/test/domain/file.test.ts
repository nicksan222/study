import assert from 'node:assert/strict';
import {
  mkdtempSync,
  openSync,
  closeSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  rmSync,
  ftruncateSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { importSource as dbImportSource } from '#backend/procedures/sources/import-file';
import { listSources as dbListSources } from '#backend/procedures/sources/sources';
import { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import { readImportFile, readMeasuredFile } from '#backend/shared/sources/file';
import { MAX_SOURCE_BYTES } from '#backend/shared/sources/sniff';

test('reads a single opened file and refuses growth or excessive size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'study-file-'));
  const path = join(dir, 'file');

  try {
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
    const store = BackendContext.open(join(dir, 'study.sqlite3'));

    assert.throws(
      () => dbImportSource(store, path),
      (e: unknown) => e instanceof StudyError && e.kind === 'invalid_input'
    );
    assert.equal(dbListSources(store).length, 0);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
