/** @file Owns message replay within this feature. */

import type { chatMessageSchema, postMessageInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';

export function assertCaptureReplay(
  message: typeof chatMessageSchema.Type,
  input: typeof postMessageInputSchema.Type
) {
  if (
    message.format !== (input.format ?? 'text') ||
    message.threadRoot !== (input.threadRoot ?? null) ||
    message.versions[0]?.text !== input.text.trim()
  )
    throw new StudyError('invalid_input', 'capture key already belongs to another note');
}
