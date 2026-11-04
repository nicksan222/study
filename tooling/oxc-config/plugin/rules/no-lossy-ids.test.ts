import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';

import { lintRule } from '../test/utils.ts';

testStable('no-lossy-ids guards production and accepts safe alternatives', () => {
  const diagnostics = lintRule('no-lossy-ids', {
    'src/bad.ts': 'Number(item.id); parseInt(projectId, 10);',
    'src/good.ts': 'Number(count); Number(durationMs); function f(Number) { Number(item.id); }',
    'src/fixture.test.ts': 'Number(item.id); parseInt(projectId, 10);'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('no-lossy-ids handles aliases and avoids unrelated bindings', () => {
  const diagnostics = lintRule('no-lossy-ids', {
    'src/bad.ts': 'Number(item["id"]); parseFloat(source_id);',
    'src/good.ts': 'function f(JSON) { return JSON.parse(row.body) as Body; } Number(pageCount);'
  });

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('no-lossy-ids covers direct unsafe forms', () => {
  const diagnostics = lintRule('no-lossy-ids', {
    'src/bad.ts': 'Number.parseInt(row.id, 10);',
    'src/good.ts': 'Number.parseInt(row.duration, 10);'
  });

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable(
  'editing tokens and captured target identities stay lossless across native prompt and replay boundaries',
  () => {
    const diagnostics = lintRule('no-lossy-ids', {
      'src/features/materials/store/unsafe.ts': `
      Number(value.expectedVersionId);
      Number(value.baseVersionId);
      parseInt(target.documentId, 10);
    `,
      'src/features/materials/decoders/safe.ts': `
      String(value.expectedVersionId);
      String(value.baseVersionId);
      String(target.documentId);
      Number(excerpt.start);
      Number(excerpt.end);
    `
    });

    assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/store/unsafe.ts')));
  }
);

testStable(
  'annotation and historic source identities stay lossless while SQLite editor offsets become numbers',
  () => {
    const diagnostics = lintRule('no-lossy-ids', {
      'src/features/materials/store/unsafe.ts': `
      Number(value.annotationId);
      Number(value.target.range.versionId);
      Number(revision.source.currentDocumentId);
    `,
      'src/features/conversations/store/offsets.ts': `
      Number(row.range_start);
      Number(row.range_end);
      Number(processing.revision);
      String(value.target.range.documentId);
    `
    });

    assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/store/unsafe.ts')));
  }
);

testStable(
  'deletion and retired receipt identities remain lossless while attempt counters are numeric',
  () => {
    const diagnostics = lintRule('no-lossy-ids', {
      'src/features/conversations/store/deletion.ts': `Number(row.session_id); parseInt(value.sessionId, 10); Number(row.attempt);`,
      'src/features/materials/store/session-retirement.ts': `Number(row.result_version_id); Number(row.proposed_version_id); String(row.base_version_id); String(value.requestId);`
    });

    assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

testStable(
  'Material cleanup members, original sources and retained candidate identities stay lossless',
  () => {
    const diagnostics = lintRule('no-lossy-ids', {
      'src/features/sources/store/material-deletion.ts': `
      Number(candidate.source_id); parseInt(member.materialId, 10); Number(owner.deletion_id);
      Number(candidate.revision); Number(status.attempt); String(candidate.source_id); String(owner.deletion_id);
    `
    });

    assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable(
  'history candidates and exact attachment roots remain lossless across preview and SQL proofs',
  () => {
    const diagnostics = lintRule('no-lossy-ids', {
      'src/features/conversations/store/material-history.ts': `
      Number(attachment.documentId); parseInt(attachment.sourceId, 10); Number(member.version_id);

      String(attachment.documentId); String(attachment.sourceId); Number(policy.keepLatest); Number(state.attempt);

    `
    });

    assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable(
  'backup inventories keep exact content identities while bounded scope counts remain numeric',
  () => {
    const diagnostics = lintRule('no-lossy-ids', {
      'src/features/system/store/backup.ts':
        'Number(row.material_id); parseInt(row.version_id, 10); Number(row.n); Number(scope.tombstones); String(row.document_id);',
      'src/features/conversations/store/backup.ts':
        'Number(row.session_id); String(row.request_id); Number(row.revision);'
    });

    assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

testStable('workspace project selections and membership identities stay lossless', () => {
  const diagnostics = lintRule(
    'no-lossy-ids',
    {
      'apps/web/src/pages/home/page.view.tsx': `Number(search.projectId);`,
      'apps/web/src/features/collections/collections-page.tsx': `parseInt(project.id, 10); Number(item.materialId);`,
      'apps/web/src/features/collections/identity.ts': `String(project.id); String(item.materialId); Number(pageCount);`
    },
    true
  );

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => !filename.endsWith('/identity.ts')));
});
