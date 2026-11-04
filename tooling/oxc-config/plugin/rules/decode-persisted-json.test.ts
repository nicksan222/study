import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

testStable('decode-persisted-json guards production and accepts safe alternatives', () => {
  const diagnostics = lintRule('decode-persisted-json', {
    'src/bad.ts': 'const body = JSON.parse(row.body) as ArtifactBody;',
    'src/good.ts':
      'const body = bodySchema.parse(JSON.parse(row.body)); const raw: unknown = JSON.parse(text);',
    'src/fixture.test.ts': 'const body = JSON.parse(row.body) as ArtifactBody;'
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('decode-persisted-json handles aliases and avoids unrelated bindings', () => {
  const diagnostics = lintRule('decode-persisted-json', {
    'src/bad.ts': 'const domain = JSON.parse(value) as Body;',
    'src/good.ts':
      'function f(JSON) { return JSON.parse(value) as Body; } const value = Schema.decodeUnknownSync(bodySchema)(JSON.parse(row.body));'
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable('decode-persisted-json covers direct unsafe forms', () => {
  const diagnostics = lintRule('decode-persisted-json', {
    'src/bad.ts': 'const domain: Body = JSON.parse(row.body);',
    'src/good.ts': 'const raw: unknown = JSON.parse(row.body);'
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

testStable(
  'rich block persistence uses the canonical codec instead of a public type assertion',
  () => {
    const diagnostics = lintRule('decode-persisted-json', {
      'src/features/materials/store/content.ts': `
      import { decodeBlockContent } from '@study/contracts/sources/document';
      import type { BlockContent } from '@study/contracts/sources/schemas';
      const safe = decodeBlockContent(row.content);
      const asserted = JSON.parse(row.content) as BlockContent;
      const assigned: BlockContent = JSON.parse(row.content);
    `
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable(
  'captured preferences and context use canonical schema codecs at persistence reads',
  () => {
    const diagnostics = lintRule('decode-persisted-json', {
      'src/features/conversations/store/capture.ts': `
      import { runSelectionContextSchema } from '@study/contracts/conversations/context';
      import { Schema } from 'effect';
      const codec = Schema.fromJsonString(Schema.toCodecJson(runSelectionContextSchema));
      const snapshot = Schema.decodeUnknownSync(codec)(row.snapshot);
      const asserted = JSON.parse(row.snapshot) as typeof runSelectionContextSchema.Type;
      const preferences: typeof runPreferencesSchema.Type = JSON.parse(row.preferences);
    `
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable(
  'durable citation targets and transform reports use canonical codecs instead of unchecked casts',
  () => {
    const diagnostics = lintRule('decode-persisted-json', {
      'src/features/materials/store/citations.ts': `
      import { Schema } from 'effect';
      import { documentTextRangeSchema } from '@study/contracts/sources/schemas';
      const codec = Schema.fromJsonString(Schema.toCodecJson(documentTextRangeSchema));
      const target = Schema.decodeUnknownSync(codec)(row.target);
      const unsafe = JSON.parse(row.target) as typeof documentTextRangeSchema.Type;
    `,
      'src/features/materials/store/generation.ts': `
      import { Schema } from 'effect';
      import { documentTransformReportSchema } from '@study/contracts/materials/schemas';
      const codec = Schema.fromJsonString(Schema.toCodecJson(documentTransformReportSchema));
      const report = Schema.decodeUnknownSync(codec)(row.result_metadata);
      const unsafe: typeof documentTransformReportSchema.Type = JSON.parse(row.result_metadata);
    `
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable('annotation history and assessment payloads require canonical schema decoding', () => {
  const diagnostics = lintRule('decode-persisted-json', {
    'src/features/materials/store/annotations.ts': `
      import { Schema } from 'effect';
      import { annotationRevisionSchema } from '@study/contracts/materials/evidence';
      const codec = Schema.fromJsonString(Schema.toCodecJson(annotationRevisionSchema));
      const revision = Schema.decodeUnknownSync(codec)(row.payload);
      const unchecked = JSON.parse(row.payload) as typeof annotationRevisionSchema.Type;
    `,
    'src/features/materials/store/citation-support.ts': `
      import { Schema } from 'effect';
      import { citationAssessmentSchema } from '@study/contracts/materials/evidence';
      const codec = Schema.fromJsonString(Schema.toCodecJson(citationAssessmentSchema));
      const assessment = Schema.decodeUnknownSync(codec)(row.payload);
      const unchecked: typeof citationAssessmentSchema.Type = JSON.parse(row.payload);
    `
  });

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable(
  'retired intents and native attempt metadata require codecs at typed read boundaries',
  () => {
    const diagnostics = lintRule('decode-persisted-json', {
      'src/features/materials/store/session-retirement.ts': `
      import { Schema } from 'effect';
      import { keepDocumentProposalSchema } from '@study/contracts/materials/editing';
      const codec = Schema.fromJsonString(Schema.toCodecJson(keepDocumentProposalSchema));
      const safe = Schema.decodeUnknownSync(codec)(row.intent);
      const unsafe = JSON.parse(row.intent) as typeof keepDocumentProposalSchema.Type;
    `,
      'src/features/workflows/store/index.ts': `const unsafe: ExecutionMetadata = JSON.parse(row.payload);`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);
