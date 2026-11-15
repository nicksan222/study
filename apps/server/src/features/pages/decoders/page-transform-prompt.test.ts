/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Tests exact rich editable targets and bounded captured Page prompts.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks UTF-8 admission, captured payload preservation and editable target scope.       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Schema-decoded captures exercise prompt policy without provider or database execution.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import {
  pageTransformContextSchema,
  transformSnapshotSchema
} from '@study/contracts/pages/transform';
import { createBlock } from '@study/contracts/sources/document';
import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { pageTransformPrompt } from './page-transform-prompt.ts';

function fixture(text = 'Exact 😀 target') {
  const block = createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });
  const document = {
    blocks: [block],
    meta: {
      extractor: null,
      extractorVersion: 1,
      provider: null,
      durationMs: null,
      pageCount: null,
      refiners: [],
      waitingFor: [],
      corrected: false,
      omissions: []
    }
  };
  const request = Schema.decodeUnknownSync(transformSnapshotSchema)({
    id: 'transform',
    contextRequestId: 'capture',
    title: 'Page',
    operations: ['clarity'],
    editTargetVersionId: 1n,
    noteId: null,
    eventId: 'event',
    instruction: 'clarify',
    cancelled: false,
    errorKind: null,
    resultVersionId: null,
    report: null
  });
  const context = Schema.decodeUnknownSync(pageTransformContextSchema)({
    requestId: 'capture',
    noteId: null,
    intentKey: 'intent',
    instruction: 'clarify',
    preferences: {},
    selectionRevision: 1n,
    messages: [],
    excludedMessages: 0,
    inputs: [
      {
        input: { kind: 'page', versionId: 1n },
        pageId: 1n,
        snapshotId: 1n,
        name: 'Original',
        scope: { kind: 'document' },
        document,
        excerpts: [
          {
            blockId: block.id,
            blockOrdinal: 0,
            start: 0,
            end: text.length,
            text,
            anchor: block.anchor,
            content: block.content
          }
        ]
      }
    ]
  });

  return { request, context };
}

function oversized(run: () => unknown) {
  expect(run).toThrowError(expect.objectContaining({ kind: 'not_enough' }));
}

testStable('Page prompts preserve exact rich editable targets and captured Unicode', () => {
  const { request, context } = fixture();
  const result = pageTransformPrompt(request, context);

  assert.strictEqual(result.editTarget, context.inputs[0]);
  const captured = JSON.parse(result.prompt);

  expect(captured.editTarget.document).toStrictEqual(context.inputs[0]!.document);
  expect(captured.inputs[0].excerpts).toStrictEqual(context.inputs[0]!.excerpts);
  assert.strictEqual(captured.inputs[0].role, 'editable_target');
  assert.strictEqual(captured.editTarget.input.versionId, '1');
  assert.ok(result.prompt.includes('😀'));
});

testStable(
  'Page prompt admission accounts for all serialized input bytes without changing the target',
  () => {
    const { request, context } = fixture();
    const before = context.inputs[0]!.document;

    for (const oversizedContext of [
      { ...context, instruction: '😀'.repeat(70000) },
      {
        ...context,
        inputs: context.inputs.map((input) => ({ ...input, name: '\u0001'.repeat(50000) }))
      },
      fixture('x'.repeat(140000)).context
    ]) {
      oversized(() => pageTransformPrompt(request, oversizedContext));
    }

    assert.strictEqual(context.inputs[0]!.document, before);
  }
);

testStable('Page transforms still require the exact whole-document editable target', () => {
  const { request, context } = fixture();

  expect(() => pageTransformPrompt(request, { ...context, inputs: [] })).toThrowError(
    expect.objectContaining({ kind: 'invalid_input' })
  );
  assert.throws(() =>
    pageTransformPrompt(request, {
      ...context,
      inputs: context.inputs.map((input) => ({
        ...input,
        scope: { kind: 'blocks' as const, blockIds: [input.excerpts[0]!.blockId] }
      }))
    })
  );
});

testStable(
  'Page prompts include only captured support excerpts with their exact identities',
  () => {
    const { request, context } = fixture();
    const support = Schema.decodeUnknownSync(pageTransformContextSchema)({
      ...context,
      inputs: [
        ...context.inputs,
        {
          ...context.inputs[0],
          input: { kind: 'page', versionId: 2n },
          name: 'Support 😀',
          document: undefined,
          scope: {
            kind: 'ranges',
            ranges: [{ blockId: context.inputs[0]!.excerpts[0]!.blockId, start: 0, end: 5 }]
          },
          excerpts: context.inputs[0]!.excerpts.map((excerpt) => ({
            ...excerpt,
            end: 5,
            text: 'Exact',
            content: undefined
          }))
        }
      ]
    });
    const captured = JSON.parse(pageTransformPrompt(request, support).prompt);

    expect(captured.inputs[1]).toStrictEqual({
      role: 'supporting_evidence',
      input: { kind: 'page', versionId: '2' },
      name: 'Support 😀',
      excerpts: JSON.parse(JSON.stringify(support.inputs[1]!.excerpts))
    });
    assert.strictEqual(captured.editTarget.input.versionId, '1');
  }
);
