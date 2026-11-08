/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maps typed learning RPC requests to the learning service and exposes its browser-  │
 * │ safe operations.                                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Delegates typed requests to the service and leaves learning rules in that layer.       │
 * │ - Preserves the public contract while delegating domain behavior to the service.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ RPC schemas come from @study/contracts; domain decisions and persistence remain owned by │
 * │ the learning service.                                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { LearningRpc } from '@study/contracts/learning/rpc';

import { Learning } from '#server/features/learning/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const LearningRpcLive = defineRpc(LearningRpc, { learning: Learning }, ({ learning }) => ({
  'learning.practice': learning.practice,
  'learning.startPractice': learning.startPractice,
  'learning.stopPractice': learning.stopPractice,
  'learning.answerPracticeQuestion': learning.answerPracticeQuestion,
  'learning.retryPracticeQuestion': learning.retryPracticeQuestion,
  'learning.attempt': ({ attemptId }) => learning.attempt(attemptId),
  'learning.findAttempt': ({ attemptId }) => learning.findAttempt(attemptId),
  'learning.card': learning.card,
  'learning.findCard': learning.findCard,
  'learning.answerQuestion': learning.answerQuestion,
  'learning.finishQuiz': learning.finishQuiz,
  'learning.gradeResponse': learning.gradeResponse,
  'learning.startQuiz': learning.startQuiz,
  'learning.reviewCard': learning.reviewCard,
  'learning.dueCards': learning.dueCards,
  'learning.attempts': learning.attempts,
  'learning.reviewHistory': learning.reviewHistory
}));
