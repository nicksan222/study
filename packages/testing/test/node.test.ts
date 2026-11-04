import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { subtests, testStable } from '@study/testing/node';

testStable(
  'Node registration preserves options, context and nested ownership',
  { timeout: 2000 },
  async (context) => {
    assert.equal(
      context.name,
      '[stable] Node registration preserves options, context and nested ownership'
    );
    await subtests(context).testStable('nested ownership', (child) => {
      assert.equal(child.name, '[stable] nested ownership');
      assert.equal(child.signal.aborted, false);
    });
  }
);

testStable('Node factories expose categories and tracked changes to the native reporter', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import {testStable, testRegression, testMigration, testCharacterization} from '@study/testing/node';
    testStable('stable fixture', () => {});
    testRegression({regression:'evidence_integrity'})('regression fixture', () => {});
    testMigration({migration:'source_upgrade',retention:'permanent'})('migration fixture', () => {});
    testCharacterization({migration:'source_upgrade',retention:'temporary',removeWhen:'Fixture completes'})('characterization fixture', () => {});
  `
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);

  for (const category of [
    'stable',
    'regression:evidence_integrity',
    'migration:source_upgrade:permanent',
    'characterization:source_upgrade:temporary'
  ])
    assert.ok(result.stdout.includes(`[${category}]`), result.stdout);
});

testStable('JavaScript callers cannot bypass classification metadata or skip coverage', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import assert from 'node:assert/strict';
    import {testStable, testRegression, testMigration, testCharacterization} from '@study/testing/node';
    assert.throws(() => testRegression({regression:'unknown'}), TypeError);
    assert.throws(() => testMigration({migration:'source_upgrade',retention:'temporary'}), TypeError);
    assert.throws(() => testMigration({migration:'source_upgrade',retention:'permanent',removeWhen:'Later'}), TypeError);
    assert.throws(() => testCharacterization({migration:'source_upgrade',retention:'permanent'}), TypeError);
    assert.throws(() => testStable('hidden', {skip:true}, () => {}), TypeError);
  `
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
});
