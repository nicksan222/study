import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBlock } from '@study/contracts/sources/document';
import { blockContentSchema } from '@study/contracts/sources/schemas';
import { Schema } from 'effect';

import { canonicalDocumentTransformOutput } from './document-transform-output.ts';

test('target proposals retain unchanged rich identities once, including reordered duplicate blocks', () => {
  const first = createBlock({ type: 'math', expression: 'x²' });
  const second = createBlock(first.content);
  const code = createBlock({ type: 'code', language: 'ts', code: 'const x = 1;' });
  const added = createBlock({ type: 'math', expression: 'y²' });
  const output = {
    blocks: [code, first, second, first, added].map((block) =>
      Schema.encodeSync(Schema.toCodecJson(blockContentSchema))(block.content)
    ),
    notes: [
      { kind: 'limit' as const, explanation: 'No factual verification', blockOrdinals: [0, 1, 2] }
    ]
  };
  const proposed = canonicalDocumentTransformOutput(output, [first, second, code]);
  const ids = proposed.content.blocks.map((block) => block.id);

  assert.deepEqual(ids.slice(0, 3), [code.id, first.id, second.id]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(![first.id, second.id, code.id, added.id].includes(ids[4]!));
  assert.deepEqual(proposed.report.notes[0]!.blockIds, [code.id, first.id, second.id]);

  const independent = canonicalDocumentTransformOutput(output);

  assert.ok(independent.content.blocks.every((block) => !ids.includes(block.id)));
  assert.deepEqual(
    independent.content.blocks.map((block) => block.content),
    proposed.content.blocks.map((block) => block.content)
  );
});
