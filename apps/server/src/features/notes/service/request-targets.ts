/** @file Owns request targets within this feature. */

import type {
  ChatMessage,
  convertMessageInputSchema,
  reanswerInputSchema,
  rewriteMessageInputSchema
} from '@study/contracts';
import { NoteMode, StudyError, canConvertMessage } from '@study/contracts';
import type { Transaction } from '@study/server';

import { NoteModeStore } from '#server/features/notes/store/assistant';
import { MessageStore } from '#server/features/notes/store/message';
import { ReplyStore } from '#server/features/notes/store/reply-operations';
import { Sources } from '#server/features/sources/index';

import { requireAvailableNote } from './availability.ts';
import { captureContext } from './context.ts';
import { emitReplyRequest } from './generation-events.ts';

export function requestTarget(
  tx: Transaction,
  input:
    | typeof rewriteMessageInputSchema.Type
    | (typeof reanswerInputSchema.Type & { origin: 'answer' })
) {
  const requestId = crypto.randomUUID();

  tx.store(ReplyStore).retireTargetPending(input);

  const message = tx.store(MessageStore).message(input.messageId);

  const context = captureContext(
    tx,
    {
      noteId: message.noteId,
      threadRoot: message.threadRoot ?? undefined,
      throughMessageId: input.origin === 'answer' ? (message.replyTo ?? undefined) : message.id,
      intentKey: requestId,
      instruction: input.origin === 'answer' ? '' : (input.instruction ?? ''),
      preferences: {}
    },
    requestId,
    true
  );

  const result = tx.store(ReplyStore).requestTarget({ ...input, requestId, context });

  emitReplyRequest(tx, result, input.origin === 'answer' ? 'reply' : 'rewrite');

  return result;
}

/** Reuses a conversion receipt or commits one new durable request for the captured version. */
export function requestConversion(tx: Transaction, input: typeof convertMessageInputSchema.Type) {
  const strategy = Sources.conversionStrategy(input.strategyId);
  const message = tx.store(MessageStore).message(input.messageId);

  if (!canConvertMessage(message, input.expectedActiveVersionId, strategy.supportedInputs))
    throw new StudyError('invalid_input', 'No convertible content');

  requireAvailableNote(tx, message.noteId);
  const { created, ...result } = tx.store(ReplyStore).requestConversion(input);

  if (created) emitReplyRequest(tx, result, 'rewrite');

  return result;
}

/** Schedules eligible saved inputs while retaining their original selected version. */
export function scheduleAutomaticConversion(
  tx: Transaction,
  message: ChatMessage,
  strategyId: string
) {
  if (tx.store(NoteModeStore).noteMode(message.noteId) === NoteMode.Assistant) return;

  const version = message.versions.find((version) => version.id === message.activeVersionId);

  if (
    !version ||
    version.origin !== 'typed' ||
    !(version.text.includes('\n') || message.parts.some((part) => part.sourceKind === 'pdf'))
  )
    return;

  try {
    const strategy = Sources.conversionStrategy(strategyId);

    if (!canConvertMessage(message, version.id, strategy.supportedInputs)) return;
  } catch (error) {
    if (error instanceof StudyError && error.kind === 'unsupported') return;

    throw error;
  }

  requestConversion(tx, {
    messageId: message.id,
    expectedActiveVersionId: version.id,
    strategyId
  });
}
