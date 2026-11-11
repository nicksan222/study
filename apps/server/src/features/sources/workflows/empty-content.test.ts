/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises durable source ingestion and correction workflows, including decoder and │
 * │ agent outcomes with SQLite state.                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises native ingestion publishes an anchored text document through Sources.        │
 * │ - Checks focused behavior using the file’s test fixtures.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Builds feature behavior through its service, store, RPC, or workflow test layer;         │
 * │ fixtures stay local to these tests.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ContentSnapshotId } from '@study/contracts/ids';
import { defaultAgentRules } from '@study/contracts/settings/types';
import { plainBlock } from '@study/contracts/sources/document';
import * as tables from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { Sources } from '#server/features/sources/index';
import { SourceStore } from '#server/features/sources/store/index';
import { layer as agentsLayer } from '#server/platform/ai/agents';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { AuthManager } from '#server/platform/ai/providers/chatgpt/session';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { decodeEvent } from '#server/platform/workflows/events';

import {
  sourceIngestionWorkflow,
  sourceIngestionHandler,
  sourceCorrectionWorkflow,
  sourceCorrectionHandler
} from './index.ts';

for (const [name, text] of [
  ['blank.txt', ' \n\t'],
  ['paragraph.html', '<main><p> </p></main>'],
  ['list.html', '<main><ul><li><ul><li> </li></ul></li></ul></main>'],
  ['cell.html', '<main><table><tr><td></td></tr></table></main>'],
  ['table.html', '<main><table><tr><td></td><td></td></tr></table></main>'],
  ['correction.txt', 'Retain this original'],
  ['empty-cell.docx', ''],
  ['empty-table.docx', '']
] as const)
  testStable(
    `${name} settles empty extraction as failed and preserves original bytes`,
    async () => {
      const location = await createTestDatabase();
      const context = new ServerContext(await location.open());
      const auth = new AuthManager({ issuer: 'http://127.0.0.1', saveRefresh: async () => {} });
      const model = createChatGptModel({ auth, modelId: 'test', baseUrl: 'http://127.0.0.1' });
      const services = Layer.mergeAll(
        Layer.mergeAll(Sources.layer, Materials.layer).pipe(
          Layer.provideMerge(Layer.succeed(Database, { store: context }))
        ),
        Layer.succeed(WorkflowConfiguration, { revision: Effect.succeed('test') }),
        agentsLayer({
          model: () => Effect.succeed(model),
          language: 'en',
          rules: Effect.succeed(defaultAgentRules),
          searchSources: () => Effect.succeed([])
        }),
        workflowEngineLayer(context)
      );

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const materials = yield* Materials;
            const bytes = name.endsWith('.docx')
              ? yield* Effect.promise(() =>
                  Bun.file(new URL('../decoders/fixtures/' + name, import.meta.url)).bytes()
                )
              : new TextEncoder().encode(text);
            const source = yield* sources.createSource({
              name,
              bytes,
              projectId: null
            });

            expect(
              (yield* materials.materials({ archived: false, limit: 10 })).items
            ).toStrictEqual([]);
            const state = yield* sources.sourceProcessing(source.id);
            const engine = yield* WorkflowEngine.WorkflowEngine;

            assert.ok(state.requestId);
            yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);
            yield* engine.register(sourceCorrectionWorkflow, sourceCorrectionHandler);
            const event = {
              type: 'SourceProcessingRequested' as const,
              sourceId: source.id,
              requestId: state.requestId,
              inputVersion: 1,
              eventId: 'empty',
              causationId: null,
              correlationId: state.requestId,
              depth: 0
            };
            let retainedDocumentId: ContentSnapshotId | null = null;
            let execution = engine.execute(sourceIngestionWorkflow, {
              executionId: 'empty',
              payload: { event }
            });

            if (name === 'correction.txt') {
              const published = yield* transaction((tx) =>
                tx.store(SourceStore).publishSourceDocument({
                  id: source.id,
                  expectedRevision: 1,
                  requestId: state.requestId!,
                  document: {
                    blocks: [plainBlock('paragraph', text, { type: 'paragraph', index: 1 })],
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
                  }
                })
              );

              retainedDocumentId = published.documentId;
              yield* sources.correctBlock({
                id: source.id,
                documentId: published.documentId,
                ordinal: 0,
                before: text,
                after: ' '
              });
              const correction = context.db.orm
                .select()
                .from(tables.workflowEvents)
                .all()
                .map((row) => decodeEvent(row.payload))
                .find((item) => item.type === 'SourceCorrectionRequested');

              assert.ok(correction?.type === 'SourceCorrectionRequested');
              execution = engine.execute(sourceCorrectionWorkflow, {
                executionId: 'empty-correction',
                payload: { event: correction }
              });
            }

            for (let replay = 0; replay < 2; replay++) {
              assert.ok((yield* Effect.flip(execution)).kind === 'invalid_input');
              const failure = context.db.orm
                .select()
                .from(tables.workflowEvents)
                .all()
                .map((row) => decodeEvent(row.payload))
                .findLast((event) => event.type === 'SourceProcessingFailed');

              assert.strictEqual(
                failure?.type === 'SourceProcessingFailed' && failure.sourceId,
                source.id
              );
              assert.strictEqual(
                (yield* sources.sourceProcessing(source.id)).documentId,
                retainedDocumentId
              );
            }

            assert.strictEqual(
              context.db.orm.select().from(tables.content_snapshots).all().length,
              retainedDocumentId === null ? 0 : 1
            );
            assert.strictEqual(
              context.db.orm
                .select()
                .from(tables.workflowEvents)
                .all()
                .filter((row) => row.type === 'SourceProcessingFailed').length,
              1
            );
            expect(
              (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
            ).toStrictEqual(new Uint8Array(bytes));

            if (retainedDocumentId !== null)
              assert.strictEqual(
                (yield* sources.document({
                  id: retainedDocumentId,
                  sourceId: source.id,
                  projectId: null
                })).document.blocks[0]!.text,
                text
              );
          }).pipe(Effect.scoped, Effect.provide(services))
        );
      } finally {
        await auth.dispose();
        context.close();
        await location.cleanup();
      }
    }
  );
