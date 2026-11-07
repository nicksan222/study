/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Runs speech inference in a terminable worker with exclusively local model reads.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

import { decodeWav, mixdownMono, resampleLinear } from '@desert-ant-labs/core/audio/node';
import { Voz } from '@desert-ant-labs/voz';
import { Schema } from 'effect';
import * as ort from 'onnxruntime-node';

import { vozModel } from './model.ts';
import { speechInputSchema, transcriptSchema } from './protocol.ts';

const input = Schema.decodeUnknownSync(speechInputSchema)(workerData);

const base = 'https://study.invalid/voz/';

const files = new Map(
  vozModel.files.map((file) => [new URL(file.path.slice(4), base).href, file.path])
);

// The SDK's default fetch can download weights. This worker has no network fallback.
globalThis.fetch = async (request) => {
  const url =
    typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  const file = files.get(url);

  if (!file) throw new Error('Speech inference only permits installed model assets');

  return new Response(await readFile(join(input.directory, file)));
};

const decoded = decodeWav(input.bytes);

if (
  decoded.sampleRate < 8000 ||
  decoded.sampleRate > 192000 ||
  decoded.channels > 32 ||
  decoded.samples.length / decoded.channels / decoded.sampleRate > 3600 ||
  !decoded.samples.every(Number.isFinite)
)
  throw new Error('WAV exceeds supported sample rate, channel count or duration');

const samples = resampleLinear(
  mixdownMono(decoded.samples, decoded.channels),
  decoded.sampleRate,
  16000
);

const voz = await Voz.load({ ort, modelBaseUrl: base, cache: false, webnn: false });

const result = await voz.transcribe(samples);

parentPort?.postMessage(Schema.decodeUnknownSync(transcriptSchema)(result));
