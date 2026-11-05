/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Collects feature-owned versioned workflow registrations into the application       │
 * │ layer, trigger list, and definition list. Runtime dispatch and recovery consume these    │
 * │ shared registration collections.                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports workflowHandlers, workflowTriggers, workflowDefinitions. Runtime dispatch and  │
 * │   recovery consume these shared registration collections.                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Imports feature registrations; Workers consumes their layers, event subscriptions, and   │
 * │ workflow definitions for dispatch and recovery.                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Layer } from 'effect';

import { sessionDeletionRegistration } from '#server/features/conversations/workflows/deletion';
import {
  conversationReplyRegistration,
  conversationAttachmentWakeRegistration
} from '#server/features/conversations/workflows/index';
import { conversationQuestionRegistration } from '#server/features/conversations/workflows/question';
import { conversationTitleRegistration } from '#server/features/conversations/workflows/title';
import { transformSuggestionRegistration } from '#server/features/conversations/workflows/transform-suggestion';
import { documentTransformRegistration } from '#server/features/documents/workflows/transform';
import {
  quizGradingRegistration,
  practiceSlotRegistration,
  practicePublicationRegistration,
  practiceFailureRegistration
} from '#server/features/learning/workflows/index';
import { materialDeletionRegistration } from '#server/features/materials/workflows/deletion';
import { materialGenerationRegistration } from '#server/features/materials/workflows/generation';
import { materialHistoryRegistration } from '#server/features/materials/workflows/history';
import { recordingPostRegistration } from '#server/features/recordings/workflows/index';
import { sourceCorrectionRegistration } from '#server/features/sources/workflows/index';
import { sourceIngestionRegistration } from '#server/features/sources/workflows/index';

/** Each workflow is registered once with its durable event subscriptions. */
const entries = [
  transformSuggestionRegistration,
  documentTransformRegistration,
  materialHistoryRegistration,
  materialDeletionRegistration,
  sessionDeletionRegistration,
  practiceFailureRegistration,
  conversationAttachmentWakeRegistration,
  recordingPostRegistration,
  materialGenerationRegistration,
  conversationTitleRegistration,
  conversationQuestionRegistration,
  conversationReplyRegistration,
  sourceIngestionRegistration,
  sourceCorrectionRegistration,
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
