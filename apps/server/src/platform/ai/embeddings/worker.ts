/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs bounded local embedding inference outside the server event loop.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Loads the local model and returns normalized vectors for bounded batches.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only its owning scoped client sends requests; remote model access stays disabled.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { Schema } from 'effect';

import { embeddingLimits } from './limits.ts';

let extractor: FeatureExtractionPipeline;

// Install the handler before loading the model so startup messages cannot be dropped.
self.onmessage = async (event: MessageEvent<unknown>) => {
  const input = event.data;

  if (typeof input === 'string' && !extractor) {
    {
      const { env, pipeline } = await import('@huggingface/transformers');

      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.useBrowserCache = false;
      env.useFSCache = false;
      extractor = await pipeline('feature-extraction', input, {
        device: 'cpu',
        dtype: 'q8',
        local_files_only: true,
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 }
      });
      self.postMessage({ ready: true });
    }

    return;
  }

  await handle(input);
};

const chunkRequest = Schema.is(
  Schema.Struct({
    operation: Schema.Literal('chunk'),
    text: Schema.String.check(Schema.isMaxLength(embeddingLimits.chunkingInputLength))
  })
);

const embeddingRequest = Schema.is(
  Schema.Struct({
    operation: Schema.Literals(['query', 'passage']),
    texts: Schema.Array(
      Schema.String.check(Schema.isMaxLength(embeddingLimits.embeddingInputLength + 9))
    ).check(Schema.isMinLength(1), Schema.isMaxLength(embeddingLimits.batchSize))
  })
);

/** Measure tokens with the installed model tokenizer rather than approximating from characters. */
function tokenCount(text: string): number {
  return extractor.tokenizer(text, { truncation: false, return_tensor: false }).input_ids.length;
}

/** Find the longest surrogate-safe passage whose prefixed tokens fit the model context. */
function passageEnd(text: string, boundaries: readonly number[], start: number): number {
  let low = start;
  let high = Math.min(boundaries.length - 1, start + 8000);

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = text.slice(boundaries[start], boundaries[middle]);

    if (tokenCount(`passage: ${candidate}`) <= embeddingLimits.tokens) low = middle;
    else high = middle - 1;
  }

  if (low === start) throw new RangeError('A passage code point exceeds the token budget');

  return low;
}

/** Keep original excerpts with token-aware overlap so embedding never silently truncates content. */
function chunkPassages(text: string): readonly string[] {
  if (!text.trim()) return [];

  const boundaries = [0];

  for (const point of text) boundaries.push(boundaries[boundaries.length - 1]! + point.length);

  const passages: string[] = [];
  let start = 0;

  while (start < boundaries.length - 1) {
    const end = passageEnd(text, boundaries, start);

    const passage = text.slice(boundaries[start], boundaries[end]);

    if (passage.trim()) passages.push(passage);

    if (end === boundaries.length - 1) break;

    start = end - Math.floor((end - start) / 5);
  }

  return passages;
}

async function handle(input: unknown) {
  if (chunkRequest(input)) {
    try {
      self.postMessage({ passages: chunkPassages(input.text) });
    } catch {
      self.postMessage({ error: 'internal' });
    }

    return;
  }

  if (
    !embeddingRequest(input) ||
    (input.operation === 'passage' &&
      input.texts.some((text) => tokenCount(text) > embeddingLimits.tokens))
  ) {
    self.postMessage({ error: 'invalid_input' });

    return;
  }

  try {
    // FeatureExtractionPipeline tokenizes with truncation:true at the pinned 512-token context.
    // Queries may use that tokenizer-aware truncation; passages must fit without losing content.
    const result = await extractor([...input.texts], { pooling: 'mean', normalize: true });
    const data = result.data;

    if (!(data instanceof Float32Array)) throw new TypeError('Unexpected embedding representation');

    const vectors = new Float32Array(data);

    self.postMessage({ vectors, count: input.texts.length }, [vectors.buffer]);
  } catch {
    self.postMessage({ error: 'internal' });
  }
}
