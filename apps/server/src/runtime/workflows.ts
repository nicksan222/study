import { Layer } from 'effect';

import {
  conversationReplyRegistration,
  conversationAttachmentWakeRegistration
} from '#server/features/conversations/workflows/index';
import { conversationTitleRegistration } from '#server/features/conversations/workflows/title';
import {
  quizGradingRegistration,
  practiceSlotRegistration,
  practicePublicationRegistration,
  practiceFailureRegistration
} from '#server/features/learning/workflows/index';
import { materialGenerationRegistration } from '#server/features/materials/workflows/generation';
import { sourceIndexedRegistration } from '#server/features/materials/workflows/index';
import { recordingPostRegistration } from '#server/features/recordings/workflows/index';
import { sourceCorrectionRegistration } from '#server/features/sources/workflows/correction';
import { sourceIngestionRegistration } from '#server/features/sources/workflows/index';

/** Each workflow is registered once with its durable event subscriptions. */
const entries = [
  practiceFailureRegistration,
  conversationAttachmentWakeRegistration,
  recordingPostRegistration,
  materialGenerationRegistration,
  conversationTitleRegistration,
  conversationReplyRegistration,
  sourceIngestionRegistration,
  sourceCorrectionRegistration,
  sourceIndexedRegistration,
  quizGradingRegistration,
  practiceSlotRegistration,
  practicePublicationRegistration
] as const;

export const workflowHandlers = Layer.mergeAll(
  entries[0].layer,
  ...entries.slice(1).map((entry) => entry.layer)
);

export const workflowTriggers = entries.flatMap((entry) => entry.triggers);

export const workflowDefinitions = entries.map((entry) => entry.definition);
