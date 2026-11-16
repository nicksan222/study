import type { agentProgressSchema } from '@study/contracts';
import type { StaticMessageKey } from '@study/localization';

type Trace = NonNullable<(typeof agentProgressSchema.Type)['trace']>;

export const runPurposeLabels = {
  procedure: 'AgentRunProcedure',
  material: 'AgentRunMaterial',
  draft: 'AgentRunDraft',
  agent: 'AgentRunAgent',
  operation: 'AgentRunOperation',
  history: 'AgentRunHistory',
  plan: 'AgentRunPlan',
  quiz: 'AgentRunQuiz',
  flashcards: 'AgentRunFlashcards',
  novelty: 'AgentRunNovelty',
  repair: 'AgentRunRepair',
  publish: 'AgentRunPublish',
  prepare: 'AgentRunPrepare',
  response: 'AgentRunResponse',
  title: 'AgentRunTitle',
  grade: 'AgentRunGrade'
} satisfies Record<Trace['purpose'], StaticMessageKey>;
