/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Explicit, verified installation and offline validation of pinned model assets.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { StudyError } from '@study/contracts/errors';
import { Effect, Schema } from 'effect';

export interface ModelAssets {
  readonly name: string;
  readonly revision: string;
  readonly identity: string;
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
}

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
export const validateModelAssets = (directory: string, model: ModelAssets) =>
  Effect.tryPromise({
    try: async () => {
      Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Struct({ identity: Schema.Literal(model.identity) }))
      )(await readFile(join(directory, 'installation.json'), 'utf8'));

      for (const file of model.files) {
        if (!(await matches(join(directory, file.path), file)))
          throw new TypeError('Local model integrity check failed');
      }
    },
    catch: (cause) =>
      new StudyError('model_unavailable', 'Local model is not installed or is invalid', {
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

      if (bytes > maximumBytes) throw new RangeError('Local model download exceeded expected size');

      await handle.writeFile(chunk);
    }
  } finally {
    await handle.close();
  }
}

/** Reuse verified assets or atomically publish a bounded, verified download with cancellation cleanup. */
async function downloadFile(
  directory: string,
  file: ModelAssets['files'][number],
  model: ModelAssets,
  signal: AbortSignal
) {
  const path = join(directory, file.path);

  if (await matches(path, file)) return;

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.partial`;

  try {
    const response = await fetch(
      `https://huggingface.co/${model.name}/resolve/${model.revision}/${file.path}`,
      { signal }
    );

    if (!response.ok || !response.body) throw new Error('Local model download failed');

    await writeDownload(response.body, temporary, file.bytes);

    if (!(await matches(temporary, file)))
      throw new TypeError('Local model download integrity check failed');

    signal.throwIfAborted();
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Explicit install is the only embedding operation that can download model assets. */
export const installModelAssets = (directory: string, model: ModelAssets) =>
  Effect.tryPromise({
    try: async (signal) => {
      await mkdir(directory, { recursive: true });

      for (const file of model.files) await downloadFile(directory, file, model, signal);

      const temporary = join(directory, `installation.${randomUUID()}.partial`);

      try {
        await writeFile(temporary, JSON.stringify({ identity: model.identity }), {
          flag: 'wx',
          mode: 0o600
        });
        await rename(temporary, join(directory, 'installation.json'));
      } finally {
        await rm(temporary, { force: true });
      }
    },
    catch: (cause) =>
      new StudyError('model_unavailable', 'Local model installation failed', { cause })
  });
