/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Source-owned speech operations share installed assets beside the workspace         │
 * │ database.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Effect } from 'effect';

import { installModelAssets, validateModelAssets } from '#server/platform/ai/model-assets';
import { transcribeAudio } from '#server/platform/ai/speech/local';
import { vozModel } from '#server/platform/ai/speech/model';

export const transcriptionModelStatus = (path: string) =>
  validateModelAssets(path, vozModel).pipe(
    Effect.match({
      onSuccess: () => ({ installed: true }),
      onFailure: () => ({ installed: false })
    })
  );

export const installTranscriptionModel = (path: string) =>
  installModelAssets(path, vozModel).pipe(Effect.as({ installed: true }));

export const transcribeSourceAudio = (path: string, bytes: Uint8Array) =>
  transcribeAudio(path, bytes);
