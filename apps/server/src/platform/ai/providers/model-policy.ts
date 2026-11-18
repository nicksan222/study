/** @file Model exclusions shared by catalog selection and inference. */
import { StudyError } from '@study/contracts';

export function allowsAiModel(...identifiers: readonly (string | undefined)[]) {
  return !identifiers.some(
    (id) => id && /(?:^|[^a-z])astra(?=[^a-z]|$)|^openrouter\/auto$/i.test(id)
  );
}

export function requireAllowedAiModel(modelId: string) {
  if (!allowsAiModel(modelId)) throw new StudyError('unsupported', 'AI model is disabled');
}
