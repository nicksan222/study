import { Layer } from 'effect';

import {
  conversationReplyHandlerLayer,
  conversationGenerationRequestedTrigger,
  conversationAttachmentWakeHandlerLayer,
  conversationAttachmentWakeTriggers
} from '#server/features/conversations/workflows/index';
import {
  conversationTitleHandlerLayer,
  conversationTitleRequestedTrigger
} from '#server/features/conversations/workflows/title';
import {
  quizGradingHandlerLayer,
  quizAnswerSubmittedTrigger,
  practiceSlotHandlerLayer,
  practiceSlotRequestedTrigger,
  practicePublicationHandlerLayer,
  practiceMaterialPublishedTrigger,
  practiceFailureHandlerLayer,
  practiceMaterialGenerationFailedTrigger
} from '#server/features/learning/workflows/index';
import {
  materialGenerationHandlerLayer,
  materialGenerationRequestedTrigger
} from '#server/features/materials/workflows/generation';
import {
  sourceIndexedHandlerLayer,
  sourceIndexedTrigger
} from '#server/features/materials/workflows/index';
import {
  recordingPostHandlerLayer,
  recordingPostRequestedTrigger
} from '#server/features/recordings/workflows/index';
import {
  sourceCorrectionHandlerLayer,
  sourceCorrectionRequestedTrigger
} from '#server/features/sources/workflows/correction';
import {
  sourceIngestionHandlerLayer,
  sourceProcessingRequestedTrigger
} from '#server/features/sources/workflows/index';

/** Each workflow is registered once with its durable event subscriptions. */
const entries = [
  {
    layer: practiceFailureHandlerLayer,
    triggers: [practiceMaterialGenerationFailedTrigger(() => true)]
  },
  {
    layer: conversationAttachmentWakeHandlerLayer,
    triggers: conversationAttachmentWakeTriggers(() => true)
  },
  { layer: recordingPostHandlerLayer, triggers: [recordingPostRequestedTrigger(() => true)] },
  {
    layer: materialGenerationHandlerLayer,
    triggers: [materialGenerationRequestedTrigger(() => true)]
  },
  {
    layer: conversationTitleHandlerLayer,
    triggers: [conversationTitleRequestedTrigger(() => true)]
  },
  {
    layer: conversationReplyHandlerLayer,
    triggers: [conversationGenerationRequestedTrigger(() => true)]
  },
  { layer: sourceIngestionHandlerLayer, triggers: [sourceProcessingRequestedTrigger(() => true)] },
  { layer: sourceCorrectionHandlerLayer, triggers: [sourceCorrectionRequestedTrigger(() => true)] },
  { layer: sourceIndexedHandlerLayer, triggers: [sourceIndexedTrigger(() => true)] },
  { layer: quizGradingHandlerLayer, triggers: [quizAnswerSubmittedTrigger(() => true)] },
  { layer: practiceSlotHandlerLayer, triggers: [practiceSlotRequestedTrigger(() => true)] },
  {
    layer: practicePublicationHandlerLayer,
    triggers: [practiceMaterialPublishedTrigger(() => true)]
  }
] as const;

export const workflowHandlers = Layer.mergeAll(
  entries[0].layer,
  ...entries.slice(1).map((entry) => entry.layer)
);

export const workflowTriggers = entries.flatMap((entry) => entry.triggers);

export const workflowDefinitions = [
  ...new Set(workflowTriggers.map((trigger) => trigger.workflow))
];
