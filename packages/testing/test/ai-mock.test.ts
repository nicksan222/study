import { test } from '@study/testing';
import { Effect, Fiber, Schema } from 'effect';

const agent = {
  id: 'counter',
  mode: 'object' as const,
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.Struct({ count: Schema.Int })
};

const tool = { input: Schema.Struct({ id: Schema.Int }), output: Schema.String };

const resolveModel = (
  mock: ReturnType<typeof test.createAiMock>,
  definition: typeof agent,
  input = { text: 'one' }
) => Effect.runPromise(mock.runtime.model('tiny', { definition, input }));

test.stable('agent definitions infer and validate exact one-shot inputs and outputs', async () => {
  const mock = test.createAiMock();
  const output = { count: 1 };
  const expected = mock.next(agent, { input: { text: 'one' }, output });

  output.count = 99;
  const model = await resolveModel(mock, agent);

  test.expect(() => mock.verify()).toThrow('AI mock verification failed');
  const result = await model.doGenerate({ prompt: [] });

  test.expect(result.content).toEqual([{ type: 'text', text: '{"count":1}' }]);
  test.expect((await expected.called).input.text).toBe('one');
  mock.verify();
  test.expect((await model.doGenerate({ prompt: [] })).content).toEqual(result.content);
  await test.expect(resolveModel(mock, agent)).rejects.toThrow('unplanned');
  test.expect(() => mock.verify()).toThrow('AI mock verification failed');
});

test.stable('schema violations are rejected before registering an expectation', () => {
  const mock = test.createAiMock();

  test
    .expect(() => mock.next(agent, { input: { text: 3 } as never, output: { count: 1 } }))
    .toThrow();
  test
    .expect(() => mock.next(agent, { input: { text: 'one' }, output: { count: '1' } as never }))
    .toThrow();
  test
    .expect(() =>
      mock.next(agent, { input: { text: 'one', extra: true } as never, output: { count: 1 } })
    )
    .toThrow();
  test
    .expect(() =>
      mock.next(agent, { input: { text: 'one' }, output: { count: 1, extra: true } as never })
    )
    .toThrow();
  mock.verify();
});

test.stable(
  'input mismatch cannot consume a later expectation or disappear from verification',
  async () => {
    const mock = test.createAiMock();

    mock.next(agent, { input: { text: 'first' }, output: { count: 1 } });
    mock.next(agent, { input: { text: 'second' }, output: { count: 2 } });
    const wrong = await resolveModel(mock, agent, { text: 'second' });

    await test.expect(wrong.doGenerate({ prompt: [] })).rejects.toThrow('unexpected input');
    const second = await resolveModel(mock, agent, { text: 'second' });

    test
      .expect((await second.doGenerate({ prompt: [] })).content)
      .toEqual([{ type: 'text', text: '{"count":2}' }]);
    test.expect(() => mock.verify()).toThrow('AI mock verification failed');
  }
);

test.stable(
  'concurrent calls consume separate plans and each held call has its own gate',
  async () => {
    const mock = test.createAiMock();
    const first = mock.next(agent, { input: { text: 'one' }, output: { count: 1 }, hold: true });
    const second = mock.next(agent, { input: { text: 'two' }, output: { count: 2 }, hold: true });
    const one = await resolveModel(mock, agent);
    const two = await resolveModel(mock, agent, { text: 'two' });
    const oneResult = one.doGenerate({ prompt: [] });
    const twoResult = two.doGenerate({ prompt: [] });

    test.expect((await first.called).input).toEqual({ text: 'one' });
    test.expect((await second.called).input).toEqual({ text: 'two' });
    second.release();
    test.expect((await twoResult).content).toEqual([{ type: 'text', text: '{"count":2}' }]);
    test.expect(() => mock.verify()).toThrow();
    first.release();
    await oneResult;
    mock.verify();
  }
);

test.stable(
  'cancelled provider calls settle their expectation without returning a success',
  async () => {
    const mock = test.createAiMock();
    const expected = mock.next(agent, { input: { text: 'one' }, output: { count: 1 }, hold: true });
    const model = await resolveModel(mock, agent);
    const controller = new AbortController();
    const result = model.doGenerate({ prompt: [], abortSignal: controller.signal }).then(
      () => undefined,
      (error: unknown) => error
    );

    await expected.called;
    controller.abort();
    await expected.aborted;
    test.expect(await result).toMatchObject({ name: 'AbortError' });
    mock.verify();
  }
);

test.stable('tool mocks return decoded schema values and never invoke an actual tool', async () => {
  const mock = test.createAiMock();
  const bigintTool = {
    input: Schema.BigIntFromString,
    output: Schema.Struct({ id: Schema.BigIntFromString })
  };
  let actualCalls = 0;

  mock.next(bigintTool, { input: 1n, output: { id: 2n } });
  const result = await Effect.runPromise(
    mock.runtime.executeTool({ definition: bigintTool, input: 1n }, () => {
      actualCalls++;

      return Effect.succeed({ id: 99n });
    })
  );

  test.expect(result).toEqual({ id: 2n });
  test.expect(actualCalls).toBe(0);
  mock.verify();
  const unexpected = await Effect.runPromise(
    Effect.flip(
      mock.runtime.executeTool({ definition: tool, input: { id: 1 } }, () => {
        actualCalls++;

        return Effect.succeed('must not run');
      })
    )
  );

  test.expect(unexpected).toBeInstanceOf(Error);
  test.expect(actualCalls).toBe(0);
  test.expect(() => mock.verify()).toThrow();
});

test.stable(
  'Effect interruption cancels a held tool expectation without executing its thunk',
  async () => {
    const mock = test.createAiMock();
    const held = mock.next(tool, { input: { id: 1 }, output: 'done', hold: true });
    let actual = false;
    const fiber = await Effect.runPromise(
      Effect.forkDetach(
        mock.runtime.executeTool({ definition: tool, input: { id: 1 } }, () => {
          actual = true;

          return Effect.succeed('actual');
        })
      )
    );

    await held.called;
    await Effect.runPromise(Fiber.interrupt(fiber));
    await held.aborted;
    test.expect(actual).toBe(false);
    mock.verify();
  }
);

test.stable(
  'same agent id with distinct contracts stays isolated while prompt clones keep identity',
  async () => {
    const mock = test.createAiMock();
    const other = {
      ...agent,
      input: Schema.Struct({ text: Schema.String }),
      output: Schema.Struct({ count: Schema.Int })
    };

    mock.next(agent, { input: { text: 'one' }, output: { count: 1 } });
    mock.next(other, { input: { text: 'one' }, output: { count: 2 } });
    const otherModel = await resolveModel(mock, other);
    const cloneModel = await resolveModel(mock, { ...agent });

    test
      .expect((await otherModel.doGenerate({ prompt: [] })).content)
      .toEqual([{ type: 'text', text: '{"count":2}' }]);
    test
      .expect((await cloneModel.doGenerate({ prompt: [] })).content)
      .toEqual([{ type: 'text', text: '{"count":1}' }]);
    mock.verify();
  }
);

test.stable(
  'bigint agent outputs cross the JSON codec boundary and stream through model events',
  async () => {
    const mock = test.createAiMock();
    const definition = { ...agent, output: Schema.Struct({ count: Schema.BigIntFromString }) };

    mock.next(definition, { input: { text: 'one' }, output: { count: 3n } });
    const model = await Effect.runPromise(
      mock.runtime.model('tiny', { definition, input: { text: 'one' } })
    );
    const result = await model.doStream({ prompt: [] });
    const parts = await Array.fromAsync(result.stream);
    const text = parts
      .filter((part) => part.type === 'text-delta')
      .map((part) => part.delta)
      .join('');

    test
      .expect(Schema.decodeUnknownSync(Schema.toCodecJson(definition.output))(JSON.parse(text)))
      .toEqual({ count: 3n });
    test.expect(parts.at(-1)?.type).toBe('finish');
    mock.verify();
  }
);

test.stable(
  'one explicit failure preserves the supplied error and later success needs a new plan',
  async () => {
    const mock = test.createAiMock();
    const failure = new Error('controlled');

    mock.failNext(agent, { input: { text: 'one' }, error: failure });
    const model = await resolveModel(mock, agent);
    const rejected = await Promise.resolve(model.doGenerate({ prompt: [] })).catch(
      (error: unknown) => error
    );

    test.expect(rejected).toBe(failure);
    mock.next(agent, { input: { text: 'one' }, output: { count: 5 } });
    await test.expect(model.doGenerate({ prompt: [] })).rejects.toBe(failure);
    const later = await resolveModel(mock, agent);

    test
      .expect((await later.doGenerate({ prompt: [] })).content)
      .toEqual([{ type: 'text', text: '{"count":5}' }]);
    mock.verify();
  }
);

test.stable('using scopes verify unused expectations automatically', () => {
  test
    .expect(() => {
      using mock = test.createAiMock();

      mock.next(agent, { input: { text: 'one' }, output: { count: 1 } });
    })
    .toThrow('AI mock verification failed');

  using empty = test.createAiMock();

  empty.verify();
});
