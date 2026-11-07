/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Pins and installs verified local embedding model assets without implicit           │
 * │ downloads.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports explicit installation and offline validation of pinned embedding assets.       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only explicit installation contacts the model host; inference validates local files.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { StudyError } from '@study/contracts/errors';
import { Effect, Schema } from 'effect';

import { embeddingLimits } from './limits.ts';

export const embeddingModel = {
  name: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dimensions: 384,
  maxChunkingInputLength: embeddingLimits.chunkingInputLength,
  identity:
    'multilingual-e5-small:761b726dd34fb83930e26aab4e9ac3899aa1fa78:q8:mean:normalized:e5-prefix-v1:token-chunks-v1-512-overlap20',
  files: [
    {
      path: 'config.json',
      bytes: 658,
      sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1'
    },
    {
      path: 'tokenizer_config.json',
      bytes: 443,
      sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b'
    },
    {
      path: 'special_tokens_map.json',
      bytes: 167,
      sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7'
    },
    {
      path: 'tokenizer.json',
      bytes: 17082730,
      sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'
    },
    {
      path: 'onnx/model_quantized.onnx',
      bytes: 118308185,
      sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193'
    }
  ]
} as const;

const installationSchema = Schema.fromJsonString(
  Schema.Struct({ identity: Schema.Literal(embeddingModel.identity) })
);

/** Check pinned file size and SHA-256, treating only absent files as a cache miss. */
async function matches(
  path: string,
  expected: { bytes: number; sha256: string }
): Promise<boolean> {
  try {
    if ((await stat(path)).size !== expected.bytes) return false;

    const hash = createHash('sha256');

    for await (const chunk of createReadStream(path)) hash.update(chunk);

    return hash.digest('hex') === expected.sha256;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;

    throw cause;
  }
}

/** Validate the complete pinned installation without permitting any network activity. */
export const validateEmbeddingModel = (directory: string) =>
  Effect.tryPromise({
    try: async () => {
      Schema.decodeUnknownSync(installationSchema)(
        await readFile(join(directory, 'installation.json'), 'utf8')
      );

      for (const file of embeddingModel.files) {
        if (!(await matches(join(directory, file.path), file)))
          throw new TypeError('Embedding model integrity check failed');
      }
    },
    catch: (cause) =>
      new StudyError('model_unavailable', 'Local embedding model is not installed or is invalid', {
        cause
      })
  });

/** Stream into an exclusive private temporary file and reject oversized downloads immediately. */
async function writeDownload(body: ReadableStream<Uint8Array>, path: string, maximumBytes: number) {
  const handle = await open(path, 'wx', 0o600);

  try {
    let bytes = 0;

    for await (const chunk of body) {
      bytes += chunk.byteLength;

      if (bytes > maximumBytes)
        throw new RangeError('Embedding model download exceeded expected size');

      await handle.writeFile(chunk);
    }
  } finally {
    await handle.close();
  }
}

/** Reuse verified assets or atomically publish a bounded, verified download with cancellation cleanup. */
async function downloadFile(
  directory: string,
  file: (typeof embeddingModel.files)[number],
  signal: AbortSignal
) {
  const path = join(directory, file.path);

  if (await matches(path, file)) return;

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.partial`;

  try {
    const response = await fetch(
      `https://huggingface.co/${embeddingModel.name}/resolve/${embeddingModel.revision}/${file.path}`,
      { signal }
    );

    if (!response.ok || !response.body) throw new Error('Embedding model download failed');

    await writeDownload(response.body, temporary, file.bytes);

    if (!(await matches(temporary, file)))
      throw new TypeError('Embedding model download integrity check failed');

    signal.throwIfAborted();
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Explicit install is the only embedding operation that can download model assets. */
export const installEmbeddingModel = (directory: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      await mkdir(directory, { recursive: true });

      for (const file of embeddingModel.files) await downloadFile(directory, file, signal);

      const temporary = join(directory, `installation.${randomUUID()}.partial`);

      try {
        await writeFile(temporary, JSON.stringify({ identity: embeddingModel.identity }), {
          flag: 'wx',
          mode: 0o600
        });
        await rename(temporary, join(directory, 'installation.json'));
      } finally {
        await rm(temporary, { force: true });
      }
    },
    catch: (cause) =>
      new StudyError('model_unavailable', 'Local embedding model installation failed', { cause })
  });
