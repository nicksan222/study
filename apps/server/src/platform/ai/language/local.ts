/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Detects confident language codes using Tongue's bundled offline model.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves source content and validates typed language results.                         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses local model assets without network requests or content publication.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Tongue } from '@desert-ant-labs/tongue';
import { StudyError } from '@study/contracts/errors';
import { Effect } from 'effect';

let model: Promise<Tongue> | undefined;

function load() {
  return (model ??= Tongue.load().catch((cause: unknown) => {
    model = undefined;

    throw cause;
  }));
}

export const detectTextLanguage = (text: string) =>
  Effect.tryPromise({
    try: async () => {
      const sample = text.slice(0, 512);

      if ((sample.match(/\p{L}/gu)?.length ?? 0) < 20) return null;

      const detection = (await load()).detect(sample);

      return detection.reliability === 'confident' && !detection.isTooCloseToCall
        ? detection.language
        : null;
    },
    catch: (cause) =>
      new StudyError('model_unavailable', 'Bundled language model could not load', { cause })
  });
