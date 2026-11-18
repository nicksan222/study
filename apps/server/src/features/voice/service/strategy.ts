/** @file Registers the decoder strategies and resolves the model selected at composition. */
import { StudyError } from '@study/contracts';
import type { VoiceModel } from '@study/contracts';
import type { SpeechAsset, VoiceRecognitionInput } from '@study/server';

import { parakeetStrategy } from './strategies/parakeet.ts';

export interface SpeechRecognitionStrategy {
  readonly model: VoiceModel;
  readonly assets: readonly SpeechAsset[];
  readonly recognize: (
    input: VoiceRecognitionInput,
    signal: AbortSignal
  ) => Promise<{ text: string }>;
}

export const speechRecognitionStrategies: readonly SpeechRecognitionStrategy[] = [parakeetStrategy];

const strategiesById = new Map<string, SpeechRecognitionStrategy>();

for (const strategy of speechRecognitionStrategies) {
  const { id } = strategy.model;

  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new StudyError('invalid_input', 'Speech model identifiers must be lowercase slugs');

  if (strategiesById.has(id))
    throw new StudyError('invalid_input', 'Speech model identifiers must be unique');

  strategiesById.set(id, strategy);
}

export function selectSpeechRecognitionStrategy(modelId = parakeetStrategy.model.id) {
  const strategy = strategiesById.get(modelId);

  if (!strategy) throw new StudyError('invalid_input', 'Speech model is not registered');

  return strategy;
}

export function speechModelDirectory(root: string, strategy: SpeechRecognitionStrategy) {
  // Parakeet was installed before per-model directories existed.
  return strategy === parakeetStrategy ? root : `${root}/models/model-${strategy.model.id}`;
}
