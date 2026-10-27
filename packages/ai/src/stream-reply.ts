import type { ModelMessage } from 'ai';

import type { StudyAgents } from './agents/index.ts';

/** Streams a reply and gives the application ownership of delta and final persistence. */
export async function streamReply(
  agents: StudyAgents,
  input: string | ModelMessage[],
  hooks: {
    onTextDelta?: (delta: string) => void | Promise<void>;
    save?: (text: string) => void | Promise<void>;
  } = {},
  signal?: AbortSignal
): Promise<string> {
  const result = await agents.reply.stream(
    typeof input === 'string'
      ? { prompt: input, abortSignal: signal }
      : { messages: input, abortSignal: signal }
  );
  let text = '';
  let finished = false;

  for await (const part of result.fullStream) {
    signal?.throwIfAborted();

    if (
      part.type === 'error' ||
      part.type === 'tool-error' ||
      part.type === 'tool-output-denied' ||
      part.type === 'abort'
    )
      throw new Error('Reply failed');

    if (part.type === 'text-delta') {
      text += part.text;
      await hooks.onTextDelta?.(part.text);
    }

    if (part.type === 'finish') {
      if (part.finishReason !== 'stop') throw new Error('Reply did not complete');

      finished = true;
    }
  }

  if (!finished) throw new Error('Reply did not complete');

  signal?.throwIfAborted();
  await hooks.save?.(text);

  return text;
}
