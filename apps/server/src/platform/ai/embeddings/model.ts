/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Pins the local embedding model and delegates explicit verified installation.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { installModelAssets, validateModelAssets } from '#server/platform/ai/model-assets';

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

export const validateEmbeddingModel = (directory: string) =>
  validateModelAssets(directory, embeddingModel);

export const installEmbeddingModel = (directory: string) =>
  installModelAssets(directory, embeddingModel);
