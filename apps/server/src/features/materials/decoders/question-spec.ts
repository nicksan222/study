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
