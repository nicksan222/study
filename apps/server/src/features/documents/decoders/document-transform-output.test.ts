/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact rich-content correspondence for target block editing identities.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers duplicate consumption, reordering and same-text structural changes.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Pure canonicalization assertions complement the native Workflow and SQLite               │
 * │ regressions.                                                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { createBlock } from '@study/contracts/sources/document';
import { blockContentSchema } from '@study/contracts/sources/schemas';
import { testStable } from '@study/testing/node';
import { Schema } from 'effect';

import { canonicalDocumentTransformOutput } from './document-transform-output.ts';

testStable(
  'target proposals retain unchanged rich identities once, including reordered duplicate blocks',
  () => {
    const first = createBlock({ type: 'math', expression: 'x²' });
    const second = createBlock(first.content);
    const code = createBlock({ type: 'code', language: 'ts', code: 'const x = 1;' });
    const added = createBlock({ type: 'math', expression: 'y²' });
    const output = {
      blocks: [code, first, second, first, added].map((block) =>
        Schema.encodeSync(Schema.toCodecJson(blockContentSchema))(block.content)
      ),
      notes: [
        {
          kind: 'limit' as const,
          explanation: 'No factual verification',
          blockOrdinals: [0, 1, 2]
        }
      ]
    };
    const proposed = canonicalDocumentTransformOutput(output, [first, second, code]);
    const ids = proposed.document.blocks.map((block) => block.id);

    assert.deepEqual(ids.slice(0, 3), [code.id, first.id, second.id]);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(![first.id, second.id, code.id].includes(ids[3]!));
    assert.ok(![first.id, second.id, code.id, added.id].includes(ids[4]!));
    assert.deepEqual(proposed.report.notes[0]!.blockIds, [code.id, first.id, second.id]);

    const independent = canonicalDocumentTransformOutput(output);

    assert.ok(independent.document.blocks.every((block) => !ids.includes(block.id)));
    assert.deepEqual(
      independent.document.blocks.map((block) => block.content),
      proposed.document.blocks.map((block) => block.content)
    );
  }
);

testStable(
  'equal text projections do not reuse IDs for changed rich table marks or list numbering',
  () => {
    const table = createBlock({
      type: 'table',
      rows: [
        { cells: [{ header: false, paragraphs: [[{ type: 'text', text: 'Same', marks: [] }]] }] }
      ]
    });
    const marked = createBlock({
      type: 'table',
      rows: [
        {
          cells: [
            { header: false, paragraphs: [[{ type: 'text', text: 'Same', marks: ['strong'] }]] }
          ]
        }
      ]
    });
    const list = createBlock({
      type: 'list_item',
      items: [
        { depth: 0, ordered: true, start: 1, inlines: [{ type: 'text', text: 'Same', marks: [] }] }
      ]
    });
    const renumbered = createBlock({
      type: 'list_item',
      items: [
        { depth: 0, ordered: true, start: 2, inlines: [{ type: 'text', text: 'Same', marks: [] }] }
      ]
    });

    assert.equal(table.text, marked.text);
    assert.equal(list.text, renumbered.text);

    const result = canonicalDocumentTransformOutput(
      {
        blocks: [marked, renumbered, table, list].map((block) =>
          Schema.encodeSync(Schema.toCodecJson(blockContentSchema))(block.content)
        ),
        notes: [{ kind: 'limit', explanation: 'Rich structure only', blockOrdinals: [0, 1, 2, 3] }]
      },
      [table, list]
    );
    const ids = result.document.blocks.map((block) => block.id);

    assert.ok(ids.slice(0, 2).every((id) => id !== table.id && id !== list.id));
    assert.deepEqual(ids.slice(2), [table.id, list.id]);
    assert.deepEqual(result.report.notes[0]!.blockIds, ids);
  }
);
