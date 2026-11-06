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

import { parentPort, workerData } from 'node:worker_threads';

import { env, pipeline } from '@huggingface/transformers';
import { Schema } from 'effect';

import { embeddingLimits } from './limits.ts';

const port = parentPort;

if (!port || typeof workerData !== 'string')
  throw new TypeError('Embedding worker requires a local model directory');

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = false;

const extractor = await pipeline('feature-extraction', workerData, {
  device: 'cpu',
  dtype: 'q8',
  local_files_only: true,
  session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 }
});

const chunkRequest = Schema.is(
  Schema.Struct({
    operation: Schema.Literal('chunk'),
    text: Schema.String.check(Schema.isMaxLength(embeddingLimits.chunkingInputLength))
  })
);

const embeddingRequest = Schema.is(
  Schema.Array(
    Schema.String.check(Schema.isMaxLength(embeddingLimits.embeddingInputLength + 9))
  ).check(Schema.isMaxLength(embeddingLimits.batchSize))
);

function tokenCount(text: string): number {
  return extractor.tokenizer(text, { truncation: false, return_tensor: false }).input_ids.length;
}

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

port.on('message', async (input: unknown) => {
  if (chunkRequest(input)) {
    try {
      port.postMessage({ passages: chunkPassages(input.text) });
    } catch {
      port.postMessage({ error: 'internal' });
    }

    return;
  }

  if (
    !embeddingRequest(input) ||
    !input.length ||
    input.some((text) => tokenCount(text) > embeddingLimits.tokens)
  ) {
    port.postMessage({ error: 'invalid_input' });

    return;
  }

  try {
    const result = await extractor([...input], { pooling: 'mean', normalize: true });
    const data = result.data;

    if (!(data instanceof Float32Array)) throw new TypeError('Unexpected embedding representation');

    const vectors = new Float32Array(data);

    port.postMessage({ vectors, count: input.length }, [vectors.buffer]);
  } catch {
    port.postMessage({ error: 'internal' });
  }
});
port.postMessage({ ready: true });
