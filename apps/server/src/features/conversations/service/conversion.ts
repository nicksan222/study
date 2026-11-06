/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Converts exact captured message content through registered conversion strategies.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Combines cleaned text and retained PDF extraction content.                             │
 * │ - Validates conversion availability and bounds published message text.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Workflow activities supply model execution and own guarded message publication.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { messageConversionSchema } from '@study/contracts/conversations/conversion';
import type { replySnapshotSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { Effect } from 'effect';
import type { Context } from 'effect';

import { Sources } from '#server/features/sources/index';

type ConversionContext = Parameters<Context.Service.Shape<typeof Sources>['convertDocument']>[2];

export const convertCapturedMessage = (
  snapshot: typeof replySnapshotSchema.Type,
  conversion: typeof messageConversionSchema.Type,
  context: ConversionContext
) =>
  Effect.gen(function* () {
    const sources = yield* Sources;
    const strategy = yield* Effect.try({
      try: () => Sources.conversionStrategy(conversion.strategyId),
      catch: (cause) =>
        cause instanceof StudyError
          ? cause
          : new StudyError('internal', 'Invalid conversion strategy', { cause })
    });
    const target = snapshot.messages.find(
      (message) => message.versionId === conversion.baseVersionId
    );

    if (!target)
      return yield* Effect.fail(new StudyError('invalid_input', 'Conversion input is unavailable'));

    const parts: string[] = [];

    if (target.text.trim() && strategy.supportedInputs.includes('text')) {
      const document = yield* sources.convertDocument(
        conversion.strategyId,
        { kind: 'text', text: target.text },
        context
      );

      parts.push(document.blocks.map((block) => block.text).join('\n\n'));
    }

    for (const attachment of target.attachments) {
      const original = yield* sources.exportRevision({
        sourceId: attachment.sourceId,
        revision: attachment.revision
      });

      if (original.mime !== 'application/pdf' || !strategy.supportedInputs.includes('pdf'))
        continue;

      const extracted = yield* sources.extraction({
        sourceId: attachment.sourceId,
        revision: attachment.revision,
        snapshotId: attachment.snapshotId
      });
      // Reuse the exact durable extraction instead of transcribing the same PDF twice.
      const document =
        extracted.document.meta.provider === conversion.strategyId
          ? extracted.document
          : yield* sources.convertDocument(
              conversion.strategyId,
              { kind: 'pdf', bytes: original.bytes },
              context
            );

      parts.push(document.blocks.map((block) => block.text).join('\n\n'));
    }

    const text = parts.filter((part) => part.trim()).join('\n\n');

    if (!text.trim() || [...text].length > 100_000)
      return yield* Effect.fail(
        new StudyError('invalid_input', 'Conversion returned empty or oversized text')
      );

    return { requestId: snapshot.requestId, text, citations: [] };
  });
