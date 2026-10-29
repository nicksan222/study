import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createProject as dbCreateProject } from '#server/procedures/projects/operations/create-project';
import { project as dbProject } from '#server/procedures/projects/operations/read-projects';
import { setExam } from '#server/procedures/projects/operations/set-exam';
import { createServerTest } from '#testing/server-test';
test('setExam validates leap days, stores dates, and clears optional dates', async (t) => {
  const f = await createServerTest(t);
  const p = dbCreateProject(f.store, 'Exam');

  await assert.rejects(
    f.caller.projects.setExam({
      id: p.id,
      examOn: '2026-02-29'
    }),
    {
      kind: 'invalid_input'
    }
  );
  assert.equal(dbProject(f.store, p.id)?.examOn, null);
  assert.equal(
    (
      await f.caller.projects.setExam({
        id: p.id,
        examOn: '2028-02-29'
      })
    ).value,
    true
  );
  assert.equal(dbProject(f.store, p.id)?.examOn, '2028-02-29');
  await f.caller.projects.setExam({
    id: p.id
  });
  assert.equal(dbProject(f.store, p.id)?.examOn, null);
  assert.equal(
    (
      await f.caller.projects.setExam({
        id: 999n
      })
    ).value,
    false
  );
});

test('setExam normalizes unpadded dates and accepts the supported calendar boundaries', async (t) => {
  const f = await createServerTest(t);
  const project = dbCreateProject(f.store, 'Dates');

  for (const [input, expected] of [
    ['2028-2-9', '2028-02-09'],
    ['0-1-1', '0000-01-01'],
    ['9999-12-31', '9999-12-31'],
    ['2000-2-29', '2000-02-29']
  ]) {
    assert.equal(setExam(f.store, project.id, input), true);
    assert.equal(dbProject(f.store, project.id)?.examOn, expected);
    assert.equal((await f.caller.projects.setExam({ id: project.id, examOn: input })).value, true);
    assert.equal(dbProject(f.store, project.id)?.examOn, expected);
  }
});

test('setExam rejects invalid dates through both entry points without changing the stored date', async (t) => {
  const f = await createServerTest(t);
  const project = dbCreateProject(f.store, 'Dates');

  setExam(f.store, project.id, '2028-02-29');

  for (const examOn of [
    '1900-02-29',
    '2026-02-29',
    '2028-02-30',
    '2026-04-31',
    '2026-0-1',
    '2026-13-1',
    '2026-1-0',
    '10000-01-01',
    '-2026-10-01',
    'soon',
    '2026-10',
    '2026-010-01',
    ' 2026-01-01',
    '2026-01-01T00:00:00Z'
  ]) {
    assert.throws(() => setExam(f.store, project.id, examOn), {
      kind: 'invalid_input',
      message: 'invalid exam date'
    });
    await assert.rejects(f.caller.projects.setExam({ id: project.id, examOn }), {
      kind: 'invalid_input'
    });
    assert.equal(dbProject(f.store, project.id)?.examOn, '2028-02-29');
  }
});
