import { test } from '@study/testing';

test.browser.stable('browser stable classification retains native identity', ({ expect }, info) => {
  expect(info.annotations).toContainEqual({
    type: 'study:test-classification',
    description: 'stable'
  });
  expect(info.file).toMatch(/classification\.browser\.test\.ts$/);
});

test.browser.regression({ regression: 'evidence_integrity' })(
  'browser regression classification retains native identity',
  ({ expect }, info) => {
    expect(info.annotations).toContainEqual({
      type: 'study:test-classification',
      description: 'regression:evidence_integrity'
    });
    expect(info.file).toMatch(/classification\.browser\.test\.ts$/);
  }
);

test.browser.migration({ migration: 'source_upgrade', retention: 'permanent' })(
  'browser migration classification retains native identity',
  ({ expect }, info) => {
    expect(info.annotations).toContainEqual({
      type: 'study:test-classification',
      description: 'migration:source_upgrade:permanent'
    });
    expect(info.file).toMatch(/classification\.browser\.test\.ts$/);
  }
);

test.browser.characterization({
  migration: 'source_upgrade',
  retention: 'temporary',
  removeWhen: 'The source upgrade is complete'
})('browser characterization classification retains native identity', ({ expect }, info) => {
  expect(info.annotations).toContainEqual({
    type: 'study:test-classification',
    description: 'characterization:source_upgrade:temporary'
  });
  expect(info.file).toMatch(/classification\.browser\.test\.ts$/);
});
