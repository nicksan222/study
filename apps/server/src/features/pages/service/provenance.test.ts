import { plainBlock } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies exact citation locations and atomic provenance validation with SQLite.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects mismatched source anchors without committing derived content.                  │
 * │ - Preserves exact citation evidence when canonical locations match.                      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public feature services and isolated SQLite fixtures without external providers.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';
import { Effect, Layer } from 'effect';

import { Pages } from '#server/features/pages/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { deletionDocument } from '#testing/material-deletion';

test.stable(
  'exact citations reject mismatched source anchors without committing a page',
  async ({ databases, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const location = await databases();
    const context = new ServerContext(await location.open());
    const layer = Pages.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const pages = yield* Pages;
          const document = deletionDocument('Exact evidence');
          const block = plainBlock('paragraph', 'Exact evidence', { type: 'page', page: 3 });

          document.blocks = [block];
          const evidence = yield* pages.create({
            createKey: 'citation-evidence',
            title: 'Evidence',
            document,
            inputs: [],
            citations: []
          });

          assert.ok(evidence.version);
          const input = { kind: 'page' as const, versionId: evidence.version.id };
          const citation = {
            marker: 1,
            input,
            anchor: block.anchor,
            target: { blockId: block.id, start: 0, end: block.text.length },
            quote: block.text
          };
          const creation = {
            createKey: 'cited-page',
            title: 'Cited page',
            document: deletionDocument('Answer [1]'),
            inputs: [input],
            citations: [citation]
          };
          const failure = yield* Effect.flip(
            pages.create({
              ...creation,
              citations: [{ ...citation, anchor: { type: 'page', page: 999 } }]
            })
          );

          assert.strictEqual(failure.kind, 'invalid_input');
          assert.strictEqual(yield* pages.count({ archived: false }), 1n);

          const accepted = yield* pages.create(creation);

          assert.ok(accepted.version);
          assert.deepStrictEqual(accepted.version.citations, [citation]);
          assert.strictEqual(yield* pages.count({ archived: false }), 2n);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
