import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

test.stable(
  'requires persisted JSON to be schema-decoded before use',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'decode-persisted-json', {
      'src/bad.ts': 'const body = JSON.parse(row.body) as ArtifactBody;',
      'src/good.ts':
        'const body = bodySchema.parse(JSON.parse(row.body)); const raw: unknown = JSON.parse(text);',
      'src/fixture.test.ts': 'const body = JSON.parse(row.body) as ArtifactBody;'
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.stable(
  'decode-persisted-json handles aliases and avoids unrelated bindings',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'decode-persisted-json', {
      'src/bad.ts': 'const domain = JSON.parse(value) as Body;',
      'src/good.ts':
        'function f(JSON) { return JSON.parse(value) as Body; } const value = Schema.decodeUnknownSync(bodySchema)(JSON.parse(row.body));'
    });

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
  }
);

test.stable('decode-persisted-json covers direct unsafe forms', async ({ assert: assertions }) => {
  const assert: test.Assert = assertions;

  const diagnostics = await lintRule({ assert }, 'decode-persisted-json', {
    'src/bad.ts': 'const domain: Body = JSON.parse(row.body);',
    'src/good.ts': 'const raw: unknown = JSON.parse(row.body);'
  });

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  assert.ok(diagnostics.every(({ filename }) => filename.endsWith('/src/bad.ts')));
});

test.stable(
  'rich block persistence uses the canonical codec instead of a public type assertion',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'decode-persisted-json', {
      'src/features/materials/store/content.ts': `
      import { decodeBlockContent } from '@study/contracts';
      import type { BlockContent } from '@study/contracts';
      const safe = decodeBlockContent(row.content);
      const asserted = JSON.parse(row.content) as BlockContent;
      const assigned: BlockContent = JSON.parse(row.content);
    `
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'captured preferences and context use canonical schema codecs at persistence reads',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'decode-persisted-json', {
      'src/features/notes/store/capture.ts': `
      import { runSelectionContextSchema } from '@study/contracts';
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

test.stable(
  'durable citation targets and transform reports use canonical codecs instead of unchecked casts',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'decode-persisted-json', {
      'src/features/materials/store/citations.ts': `
      import { Schema } from 'effect';
      import { documentTextRangeSchema } from '@study/contracts';
      const codec = Schema.fromJsonString(Schema.toCodecJson(documentTextRangeSchema));
      const target = Schema.decodeUnknownSync(codec)(row.target);
      const unsafe = JSON.parse(row.target) as typeof documentTextRangeSchema.Type;
    `,
      'src/features/materials/store/generation.ts': `
      import { Schema } from 'effect';
      import { transformReportSchema } from '@study/contracts';
      const codec = Schema.fromJsonString(Schema.toCodecJson(transformReportSchema));
      const report = Schema.decodeUnknownSync(codec)(row.result_metadata);
      const unsafe: typeof transformReportSchema.Type = JSON.parse(row.result_metadata);
    `
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'annotation history and assessment payloads require canonical schema decoding',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'decode-persisted-json', {
      'src/features/materials/store/annotations.ts': `
      import { Schema } from 'effect';
      import { annotationRevisionSchema } from '@study/contracts';
      const codec = Schema.fromJsonString(Schema.toCodecJson(annotationRevisionSchema));
      const revision = Schema.decodeUnknownSync(codec)(row.payload);
      const unchecked = JSON.parse(row.payload) as typeof annotationRevisionSchema.Type;
    `,
      'src/features/materials/store/citation-support.ts': `
      import { Schema } from 'effect';
      import { citationAssessmentSchema } from '@study/contracts';
      const codec = Schema.fromJsonString(Schema.toCodecJson(citationAssessmentSchema));
      const assessment = Schema.decodeUnknownSync(codec)(row.payload);
      const unchecked: typeof citationAssessmentSchema.Type = JSON.parse(row.payload);
    `
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable(
  'retired intents and native attempt metadata require codecs at typed read boundaries',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lintRule({ assert }, 'decode-persisted-json', {
      'src/features/materials/store/note-retirement.ts': `
      import { Schema } from 'effect';
      import { keepProposalSchema } from '@study/contracts';
      const codec = Schema.fromJsonString(Schema.toCodecJson(keepProposalSchema));
      const safe = Schema.decodeUnknownSync(codec)(row.intent);
      const unsafe = JSON.parse(row.intent) as typeof keepProposalSchema.Type;
    `,
      'src/features/workflows/store/index.ts': `const unsafe: ExecutionMetadata = JSON.parse(row.payload);`
    });

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);
