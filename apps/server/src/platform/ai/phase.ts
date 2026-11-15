/** @file Provides the inherited semantic phase for model invocation progress. */

import type { agentPhaseSchema } from '@study/contracts/ai/progress';
import { Context } from 'effect';

/** Semantic role of the current model invocation, inherited through its scoped work. */
export const AiPhase = Context.Reference<typeof agentPhaseSchema.Type>('study/AiPhase', {
  defaultValue: () => 'generating'
});
