/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates generated question specifications against supported question kinds and   │
 * │ required fields.                                                                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects unsupported kinds and malformed generated question counts.                     │
 * │ - Rejects invalid values before downstream feature operations consume them.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This materials validation boundary consumes canonical values; persistence and            │
 * │ orchestration remain with feature services.                                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type {
  materialGenerationInputSchema,
  materialGenerationPublicationSchema
} from '@study/contracts/materials/schemas';

export function assertQuestionSpec(
  spec: (typeof materialGenerationInputSchema.Type)['questionSpec'],
  content: (typeof materialGenerationPublicationSchema.Type)['content']
) {
  if (!spec) return;

  if (
    content.kind !== 'quiz' ||
    content.questions.length !== spec.count ||
    (spec.kind === 'open'
      ? content.questions[0]?.kind !== 'open'
      : !['single_choice', 'multiple_choice'].includes(content.questions[0]?.kind ?? ''))
  )
    throw new StudyError('invalid_input', 'Generated quiz does not match question specification');
}

export function assertQuizConfig(
  config: (typeof materialGenerationInputSchema.Type)['quizConfig'],
  content: (typeof materialGenerationPublicationSchema.Type)['content']
) {
  if (!config) return;

  if (
    content.kind !== 'quiz' ||
    content.questions.length !== config.questionCount ||
    content.questions.some((question) =>
      question.kind === 'open'
        ? config.questionKind === 'choice'
        : config.questionKind === 'open' || question.choices.length !== config.choiceCount
    )
  )
    throw new StudyError('invalid_input', 'Generated quiz does not match quiz configuration');
}
