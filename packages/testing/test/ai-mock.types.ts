import { createAiMock } from '@study/testing/ai-mock';
import { Schema } from 'effect';

function typeAssertions() {
  const mock = createAiMock();
  const agent = {
    id: 'structured',
    mode: 'object' as const,
    input: Schema.Struct({ prompt: Schema.String }),
    output: Schema.Struct({ count: Schema.Int })
  };
  const tool = { input: Schema.Struct({ id: Schema.BigIntFromString }), output: Schema.Boolean };
  const plan = mock.next(agent, { input: { prompt: 'text' }, output: { count: 1 } });
  const called: Promise<{ readonly input: { readonly prompt: string } }> = plan.called;

  void called;
  mock.next(tool, { input: { id: 1n }, output: true });
  // @ts-expect-error Agent input is inferred solely from the actual input schema.
  mock.next(agent, { input: { prompt: 2 }, output: { count: 1 } });
  // @ts-expect-error Agent output is inferred solely from the actual output schema.
  mock.next(agent, { input: { prompt: 'text' }, output: { count: 'one' } });
  // @ts-expect-error Input is required even when the output is valid.
  mock.next(agent, { output: { count: 1 } });
  // @ts-expect-error Output is required.
  mock.next(agent, { input: { prompt: 'text' } });
  // @ts-expect-error Codec inputs use decoded bigint values.
  mock.next(tool, { input: { id: '1' }, output: true });
  // @ts-expect-error Tool output cannot widen the target schema.
  mock.next(tool, { input: { id: 1n }, output: 'true' });
  // @ts-expect-error Extra fields do not become part of the agent contract.
  mock.next(agent, { input: { prompt: 'text', extra: true }, output: { count: 1 } });
}

void typeAssertions;
