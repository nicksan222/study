import { createChoiceQuestionAgent } from './choice-question.ts';
import { createDiagramAgent } from './diagram.ts';
import { createFlashcardsAgent } from './flashcards.ts';
import { createGradeAgent } from './grade.ts';
import { createOpenQuestionAgent } from './open-question.ts';
import { generateQuestion } from './question.ts';
import type { Question } from './question.ts';
import { createReplyAgent } from './reply.ts';
import { createRewriteAgent } from './rewrite.ts';
import { createAgentContext } from './shared.ts';
import type { AgentOptions } from './shared.ts';
import { createTitleAgent } from './title.ts';

export type { AgentOptions } from './shared.ts';
export type { Question } from './question.ts';
export { gradeSchema } from './grade.ts';
export { choiceQuestionSchema } from './choice-question.ts';
export { openQuestionSchema } from './open-question.ts';
export { flashcardsSchema } from './flashcards.ts';
export { diagramSchema } from './diagram.ts';

/** Creates reusable AI SDK agents with application-owned source access. */
export function createStudyAgents(options: AgentOptions) {
  const context = createAgentContext(options);
  const questions = {
    choiceQuestion: createChoiceQuestionAgent(context),
    openQuestion: createOpenQuestionAgent(context)
  };

  return {
    title: createTitleAgent(context),
    reply: createReplyAgent(context),
    rewrite: createRewriteAgent(context),
    question(kind: 'choice' | 'open', prompt: string, signal?: AbortSignal): Promise<Question> {
      return generateQuestion(questions, kind, prompt, signal);
    },
    flashcards: createFlashcardsAgent(context),
    diagram: createDiagramAgent(context),
    grade: createGradeAgent(context)
  };
}

export type StudyAgents = ReturnType<typeof createStudyAgents>;
