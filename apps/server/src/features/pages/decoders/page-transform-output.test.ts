import { createBlock } from '@study/contracts';
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
import { blockContentSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { canonicalPageTransformOutput } from './page-transform-output.ts';

test.stable(
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
    const proposed = canonicalPageTransformOutput(output, [first, second, code]);
    const ids = proposed.document.blocks.map((block) => block.id);

    test.expect(ids.slice(0, 3)).toStrictEqual([code.id, first.id, second.id]);
    test.assert.strictEqual(new Set(ids).size, ids.length);
    test.assert.ok(![first.id, second.id, code.id].includes(ids[3]!));
    test.assert.ok(![first.id, second.id, code.id, added.id].includes(ids[4]!));
    test.expect(proposed.report.notes[0]!.blockIds).toStrictEqual([code.id, first.id, second.id]);

    const independent = canonicalPageTransformOutput(output);

    test.assert.ok(independent.document.blocks.every((block) => !ids.includes(block.id)));
    test
      .expect(independent.document.blocks.map((block) => block.content))
      .toStrictEqual(proposed.document.blocks.map((block) => block.content));
  }
);

test.stable(
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

    test.assert.strictEqual(table.text, marked.text);
    test.assert.strictEqual(list.text, renumbered.text);

    const result = canonicalPageTransformOutput(
      {
        blocks: [marked, renumbered, table, list].map((block) =>
          Schema.encodeSync(Schema.toCodecJson(blockContentSchema))(block.content)
        ),
        notes: [{ kind: 'limit', explanation: 'Rich structure only', blockOrdinals: [0, 1, 2, 3] }]
      },
      [table, list]
    );
    const ids = result.document.blocks.map((block) => block.id);

    test.assert.ok(ids.slice(0, 2).every((id) => id !== table.id && id !== list.id));
    test.expect(ids.slice(2)).toStrictEqual([table.id, list.id]);
    test.expect(result.report.notes[0]!.blockIds).toStrictEqual(ids);
  }
);
