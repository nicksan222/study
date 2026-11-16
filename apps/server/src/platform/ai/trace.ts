/** @file Carries procedure ancestry across agent and provider callback boundaries. */

import type { agentRunIdSchema } from '@study/contracts';
import { Context } from 'effect';

export const agentNestingLimit = 16;

export const ProcedureTraceScope = Context.Reference<{
  parentRunId: typeof agentRunIdSchema.Type | null;
  parentToolCallId?: string;
  toolKey?: string;
  depth: number;
  path: string;
}>('study/ProcedureTraceScope', {
  defaultValue: () => ({ parentRunId: null, depth: 0, path: '' })
});

/** Each procedure attempt owns a fresh deterministic sequence for its agent calls. */
export const AgentCallSequence = Context.Reference<{ next: number } | undefined>(
  'study/AgentCallSequence',
  {
    defaultValue: () => undefined
  }
);

/** Bound presentation details without changing the canonical validated input or result. */
export function traceDetail(value: unknown) {
  let text: string;

  try {
    text =
      JSON.stringify(
        value,
        (_, item: unknown) => (typeof item === 'bigint' ? String(item) : item),
        2
      ) ?? '';
  } catch {
    text = '[Unserializable value]';
  }

  return { text: text.slice(0, 12000), truncated: text.length > 12000 };
}
