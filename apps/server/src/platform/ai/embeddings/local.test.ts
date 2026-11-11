/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies local model integrity and real multilingual embedding behavior offline.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exercises missing installations, semantic ranking, input bounds and worker disposal.   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests explicitly install pinned assets; ordinary inference never initiates downloads.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { AutoTokenizer } from '@huggingface/transformers';
import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { Effect, FileSystem, Path } from 'effect';
import { expect } from 'vite-plus/test';

import { LocalEmbeddings } from './local.ts';
import type { LocalEmbeddingModel } from './local.ts';
import { embeddingModel, installEmbeddingModel } from './model.ts';

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const { join, resolve } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const modelDirectory = resolve('target/embedding-model');

testStable(
  'local query embeddings truncate dense valid queries while rejecting oversized passages',
  async () => {
    await Effect.runPromise(installEmbeddingModel(modelDirectory));
    const query = Array.from({ length: 2000 }, (_, index) =>
      String.fromCodePoint(0x4e00 + index)
    ).join('');
    const tokenizer = await AutoTokenizer.from_pretrained(modelDirectory, {
      local_files_only: true
    });

    expect(
      tokenizer(`query: ${query}`, { truncation: false, return_tensor: false }).input_ids.length
    ).toBeGreaterThan(512);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const model = yield* LocalEmbeddings.open(modelDirectory);
          const vector = yield* model.embedQuery(query);

          expect(vector).toHaveLength(384);
          expect(vector.every(Number.isFinite)).toBe(true);
          expect(cosine(vector, vector)).toBeCloseTo(1, 4);
          const passage = yield* Effect.result(model.embedPassages([query]));

          expect(passage._tag).toBe('Failure');

          if (passage._tag === 'Failure') expect(passage.failure.kind).toBe('invalid_input');
        })
      )
    );
  }
);

testStable(
  'token-aware local passage chunks cover dense Unicode without silent model truncation',
  async () => {
    await Effect.runPromise(installEmbeddingModel(modelDirectory));
    const tokenizer = await AutoTokenizer.from_pretrained(modelDirectory, {
      local_files_only: true
    });
    const base = Array.from(
      { length: 2200 },
      (_, index) => String.fromCodePoint(0x4e00 + index) + (index % 29 === 0 ? '🌱' : '')
    ).join('');
    const text = base.slice(0, 800) + '紫外线通过光合作用帮助植物产生能量' + base.slice(800);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const model = yield* LocalEmbeddings.open(modelDirectory);
          const chunks = yield* model.chunkPassages(text);
          let covered = 0;
          let previousStart = -1;

          expect(chunks.length).toBeGreaterThan(2);

          for (const chunk of chunks) {
            const start = text.indexOf(chunk, previousStart + 1);

            expect(start).toBeGreaterThanOrEqual(0);
            expect(start).toBeLessThanOrEqual(covered);
            expect(chunk).not.toMatch(/\p{Surrogate}/u);
            expect(
              tokenizer(`passage: ${chunk}`, { truncation: false, return_tensor: false }).input_ids
                .length
            ).toBeLessThanOrEqual(512);
            covered = start + chunk.length;
            previousStart = start;
          }

          expect(covered).toBe(text.length);
          expect(chunks.some((chunk) => chunk.includes('紫外线通过光合作用帮助植物产生能量'))).toBe(
            true
          );
          expect(yield* model.chunkPassages('  ')).toStrictEqual([]);
          const whitespace = yield* model.chunkPassages(' '.repeat(9000) + 'Plants need sunlight.');

          expect(whitespace.every((chunk) => chunk.trim().length > 0)).toBe(true);
          expect(whitespace.some((chunk) => chunk.includes('Plants need sunlight.'))).toBe(true);
          const rejected = yield* Effect.result(model.embedPassages([text]));

          expect(rejected._tag).toBe('Failure');

          if (rejected._tag === 'Failure') expect(rejected.failure.kind).toBe('invalid_input');

          const vectors = yield* model.embedPassages(chunks.slice(0, 16));

          expect(vectors).toHaveLength(Math.min(chunks.length, 16));
        })
      )
    );
  }
);

function cosine(left: Float32Array, right: Float32Array) {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

testStable('local embeddings reject absent and corrupt models without downloading', async () => {
  const directory = await Effect.runPromise(fs.makeTempDirectory({ prefix: 'study-model-' }));

  try {
    const missing = await Effect.runPromise(
      Effect.result(Effect.scoped(LocalEmbeddings.open(directory)))
    );

    expect(missing._tag).toBe('Failure');

    if (missing._tag === 'Failure') expect(missing.failure.kind).toBe('model_unavailable');

    await Bun.write(
      join(directory, 'installation.json'),
      JSON.stringify({ identity: embeddingModel.identity })
    );
    await Bun.write(join(directory, 'config.json'), '{}');
    const corrupt = await Effect.runPromise(
      Effect.result(Effect.scoped(LocalEmbeddings.open(directory)))
    );

    expect(corrupt._tag).toBe('Failure');

    if (corrupt._tag === 'Failure') expect(corrupt.failure.kind).toBe('model_unavailable');
  } finally {
    await Effect.runPromise(fs.remove(directory, { recursive: true, force: true }));
  }
});

testStable(
  'real offline multilingual embeddings rank related English and Italian passages above unrelated text',
  async () => {
    await Effect.runPromise(installEmbeddingModel(modelDirectory));
    let retained: LocalEmbeddingModel | undefined;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const model = yield* LocalEmbeddings.open(modelDirectory);

          retained = model;
          const passages = yield* model.embedPassages([
            'Le piante utilizzano la luce solare per trasformare acqua e anidride carbonica in energia attraverso la fotosintesi.',
            'The train departs from the station at seven in the morning.'
          ]);
          const query = yield* model.embedQuery('How do plants convert sunlight into energy?');

          expect(query).toHaveLength(384);
          expect(passages).toHaveLength(2);
          expect(cosine(query, passages[0]!)).toBeGreaterThan(cosine(query, passages[1]!) + 0.05);
          expect(query.every(Number.isFinite)).toBe(true);
          expect(cosine(query, query)).toBeCloseTo(1, 4);
          expect(yield* model.embedPassages([])).toStrictEqual([]);
          const invalid = yield* Effect.result(model.embedQuery('   '));

          expect(invalid._tag).toBe('Failure');

          if (invalid._tag === 'Failure') expect(invalid.failure.kind).toBe('invalid_input');

          const oversized = yield* Effect.result(
            model.embedPassages(Array.from({ length: 17 }, () => 'text'))
          );

          expect(oversized._tag).toBe('Failure');

          if (oversized._tag === 'Failure') expect(oversized.failure.kind).toBe('invalid_input');
        })
      )
    );
    expect(retained).toBeDefined();
    const disposed = await Effect.runPromise(Effect.result(retained!.embedQuery('plants')));

    expect(disposed._tag).toBe('Failure');

    if (disposed._tag === 'Failure') expect(disposed.failure.kind).toBe('model_unavailable');
  }
);

testStable(
  'real local requests serialize concurrent queries, cancel callers, and bound queue admission',
  async () => {
    await Effect.runPromise(installEmbeddingModel(modelDirectory));
    let retained: LocalEmbeddingModel | undefined;

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const model = yield* LocalEmbeddings.open(modelDirectory);

          retained = model;
          yield* Effect.tryPromise({
            try: async () => {
              const activeController = new AbortController();
              const queuedController = new AbortController();
              const active = Effect.runPromise(
                model.embedPassages(
                  Array.from({ length: 16 }, () =>
                    'Plants use sunlight to generate energy. '.repeat(20)
                  )
                ),
                { signal: activeController.signal }
              );
              const activeCancelled = active.then(
                () => false,
                () => true
              );

              // Overlap callers; worker-client.test.ts separately holds native replies deterministically.
              await Promise.resolve();
              const queued = Effect.runPromise(model.embedQuery('cancel this queued query'), {
                signal: queuedController.signal
              });
              const queuedCancelled = queued.then(
                () => false,
                () => true
              );
              const query = Effect.runPromise(Effect.result(model.embedQuery('sunlight')));

              queuedController.abort();
              activeController.abort();
              expect(await activeCancelled).toBe(true);
              expect(await queuedCancelled).toBe(true);
              const result = await query;

              expect(result._tag).toBe('Success');

              if (result._tag === 'Success') expect(result.success).toHaveLength(384);

              const subsequent = await Effect.runPromise(model.embedQuery('plants'));

              expect(subsequent).toHaveLength(384);
              const capacity = await Promise.all(
                Array.from({ length: 20 }, () =>
                  Effect.runPromise(Effect.result(model.embedQuery('sunlight')))
                )
              );

              expect(capacity.filter((result) => result._tag === 'Failure')).toHaveLength(3);
              expect(
                capacity
                  .filter((result) => result._tag === 'Failure')
                  .every(
                    (result) => result._tag === 'Failure' && result.failure.kind === 'rate_limited'
                  )
              ).toBe(true);
            },
            catch: (cause) =>
              new StudyError('internal', 'Embedding serialization verification failed', { cause })
          });
        })
      )
    );
    const closed = await Effect.runPromise(Effect.result(retained!.embedQuery('sunlight')));

    expect(closed._tag).toBe('Failure');

    if (closed._tag === 'Failure') expect(closed.failure.kind).toBe('model_unavailable');
  }
);
