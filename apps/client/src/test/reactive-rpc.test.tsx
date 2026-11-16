import { noteIdSchema } from '@study/contracts';
import type { Note } from '@study/contracts';
import { endpoints } from '@study/contracts';
import type { ProtocolTransport } from '@study/contracts/react';
import { rpc, RpcProvider, useIndependentMutation } from '@study/contracts/react';
import { test } from '@study/testing';
import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

test.unit.stable(
  'snapshot fixtures reject unplanned endpoints instead of inventing empty data',
  async ({ rpcValuesTransport, expect }) => {
    const fixture = rpcValuesTransport({});
    const result = await Effect.runPromise(
      fixture.transport
        .execute(endpoints.notes.get.rpc, {
          id: noteIdSchema.make(91n)
        })
        .pipe(Effect.result)
    );

    expect(result).toMatchObject({ failure: { kind: 'unsupported' } });
  }
);

const id = noteIdSchema.make(9007199254740993n);

const note = (title: string): Note => ({
  id,
  title,
  titleSource: 'user',
  projectIds: [],
  archivedAt: null,
  createdAt: 1n,
  updatedAt: 2n
});

test.unit.stable(
  'RPC scenarios use typed snapshots and handlers and refresh mounted queries',
  async ({ createRpcScenario, renderHook, waitFor, expect, act }) => {
    const scenario = createRpcScenario();

    scenario.given({ 'notes.note': note('Original') });
    scenario.handle({
      'notes.renameNote': ({ title }) => {
        const renamed = note(title);

        scenario.given({ 'notes.note': renamed });

        return renamed;
      }
    });
    const view = renderHook(
      () => ({
        query: rpc.notes.get.useQuery({ id }),
        rename: rpc.notes.rename.useMutation()
      }),
      { wrapper: scenario.wrapper }
    );

    await waitFor(() => expect(view.result.current.query.data?.title).toBe('Original'));
    await act(async () => {
      await view.result.current.rename.mutateAsync({ id, title: 'Saved' });
    });
    await waitFor(() => expect(view.result.current.query.data?.title).toBe('Saved'));
    await act(async () => {
      await scenario.update({ 'notes.note': note('External change') });
    });
    expect(view.result.current.query.data?.title).toBe('External change');
    scenario.verify();
  }
);

test.unit.stable(
  'RPC scenarios report undeclared requests even if a view handles their errors',
  async ({ createRpcScenario, expect }) => {
    const scenario = createRpcScenario();

    await Effect.runPromise(
      scenario.transport.execute(endpoints.notes.get.rpc, { id }).pipe(Effect.result)
    );
    expect(() => scenario.verify()).toThrow('Unplanned test RPC');
  }
);

test.unit.stable(
  'notifications during a pending snapshot retain the latest refresh',
  async ({ rpcTestTransport, renderHook, act, waitFor, expect }) => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let title = 'Before';
    let first = true;
    const fixture = rpcTestTransport(async () => {
      const value = note(title);

      if (first) {
        first = false;
        entered.resolve();
        await release.promise;
      }

      return value;
    });
    const view = renderHook(() => rpc.notes.get.useQuery({ id }), { wrapper: fixture.wrapper });

    await entered.promise;
    title = 'After';
    await act(async () => {
      const notification = fixture.notify();

      release.resolve();
      await notification;
    });
    await waitFor(() => expect(view.result.current.data?.title).toBe('After'));
  }
);

test.unit.stable(
  'canonical bigint inputs share one subscription and context replacement releases it',
  async ({ rpcTestTransport, renderHook, waitFor, expect }) => {
    const first = rpcTestTransport(async () => note('First'));
    const second = rpcTestTransport(async () => note('Second'));
    const view = renderHook(
      () => {
        const a = rpc.notes.get.useQuery({ id });
        const b = rpc.notes.get.useQuery({ id });

        return { a, b };
      },
      { wrapper: first.wrapper }
    );

    await waitFor(() => expect(view.result.current.a.data?.title).toBe('First'));
    expect(view.result.current.b.data?.title).toBe('First');
    expect(first.activeSubscriptions()).toBe(1);
    view.unmount();
    await waitFor(() => expect(first.activeSubscriptions()).toBe(0));
    const replacement = renderHook(() => rpc.notes.get.useQuery({ id }), {
      wrapper: second.wrapper
    });

    await waitFor(() => expect(replacement.result.current.data?.title).toBe('Second'));
    expect(second.activeSubscriptions()).toBe(1);
    replacement.unmount();
    await waitFor(() => expect(second.activeSubscriptions()).toBe(0));
  }
);

test.unit.stable(
  'disabled absent input does not manufacture a snapshot or open transport',
  ({ rpcTestTransport, renderHook, expect }) => {
    const fixture = rpcTestTransport(async () => {
      throw new Error('must remain disabled');
    });
    const view = renderHook(() => rpc.notes.get.useQuery(undefined), {
      wrapper: fixture.wrapper
    });

    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isPending).toBe(true);
    expect(fixture.activeSubscriptions()).toBe(0);
  }
);

test.unit.stable(
  'concurrent mutation calls retain their own results and never replay on recovery',
  async ({ renderHook, act, waitFor, expect }) => {
    const completions = new Map<number, (value: string) => void>();
    let calls = 0;
    const invoke = (input: number) =>
      Effect.promise(() => {
        calls++;
        const task = deferred<string>();

        completions.set(input, task.resolve);

        return task.promise;
      });
    const view = renderHook(() => useIndependentMutation(invoke));
    let first!: Promise<string>;
    let second!: Promise<string>;

    act(() => {
      first = view.result.current.mutate(1);
      second = view.result.current.mutate(2);
    });
    await waitFor(() => expect(completions.size).toBe(2));
    await act(async () => {
      completions.get(2)?.('second');
      await second;
    });
    expect(view.result.current.data).toBe('second');
    expect(view.result.current.pending).toBe(1);
    await act(async () => {
      completions.get(1)?.('first');
      await first;
    });
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(view.result.current.data).toBe('second');
    expect(view.result.current.pending).toBe(0);
    expect(calls).toBe(2);
  }
);

/** Compile-time endpoint classification and branded input checks. */
function invalidHooks() {
  // @ts-expect-error queries do not expose mutation hooks
  rpc.notes.get.useMutation();
  // @ts-expect-error mutations do not expose query hooks
  rpc.notes.rename.useQuery({ id, title: 'Title' });
  // @ts-expect-error IDs must be decoded/branded
  rpc.notes.get.useQuery({ id: 1n });
  // @ts-expect-error required payload fields cannot be omitted
  rpc.notes.rename.call({ id });
}

test.unit.stable(
  'mutation reset clears submitted variables without cancelling the caller result',
  async ({ renderHook, act, waitFor, expect }) => {
    const task = deferred<string>();
    const effect = Effect.promise(() => task.promise);
    const invoke = (_secret: string) => effect;
    const view = renderHook(() => useIndependentMutation(invoke));
    let result!: Promise<string>;

    act(() => {
      result = view.result.current.mutate('private-token');
    });
    await waitFor(() => expect(view.result.current.variables).toBe('private-token'));
    act(() => view.result.current.reset());
    expect(view.result.current.variables).toBeUndefined();
    expect(view.result.current.data).toBeUndefined();
    await act(async () => {
      task.resolve('accepted');
      await result;
    });
    expect(await result).toBe('accepted');
    expect(view.result.current.data).toBeUndefined();
  }
);

test.unit.stable(
  'late mutation completion cannot publish into a replacement transport context',
  async ({ rpcTestTransport, renderHook, act, waitFor, expect }) => {
    const task = deferred<string>();
    const effect = Effect.promise(() => task.promise);
    const invoke = (_input: string) => effect;
    const first = rpcTestTransport(async () => undefined);
    const second = rpcTestTransport(async () => undefined);
    let replace!: () => void;

    function Provider({ children }: { children: ReactNode }) {
      const [transport, setTransport] = useState(first.transport);

      useEffect(() => {
        replace = () => setTransport(second.transport);
      }, []);

      return <RpcProvider transport={transport}>{children}</RpcProvider>;
    }

    const view = renderHook(() => useIndependentMutation(invoke), { wrapper: Provider });
    let result!: Promise<string>;

    act(() => {
      result = view.result.current.mutate('old-context');
    });
    await waitFor(() => expect(view.result.current.isPending).toBe(true));
    act(() => replace());
    expect(view.result.current.isPending).toBe(false);
    expect(view.result.current.variables).toBeUndefined();
    await act(async () => {
      task.resolve('old-result');
      await result;
    });
    expect(await result).toBe('old-result');
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.pending).toBe(0);
  }
);

test.unit.stable(
  'omitted and undefined optional payload fields share an immutable canonical input',
  async ({ rpcTestTransport, renderHook, waitFor, expect }) => {
    const fixture = rpcTestTransport(async () => ({ items: [], next: null }));
    const captured: unknown[] = [];
    const transport: ProtocolTransport = {
      execute: fixture.transport.execute,
      subscribe(definition, input) {
        captured.push(input);

        return fixture.transport.subscribe(definition, input);
      }
    };
    const input = { limit: 30 };
    const view = renderHook(
      () => ({
        first: rpc.notes.list.useQuery(input),
        second: rpc.notes.list.useQuery({ limit: 30, project: undefined })
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <RpcProvider transport={transport}>{children}</RpcProvider>
        )
      }
    );

    await waitFor(() =>
      expect(view.result.current.first.isSuccess && view.result.current.second.isSuccess).toBe(true)
    );
    expect(captured).toHaveLength(1);
    input.limit = 60;
    expect(captured[0]).toEqual({ limit: 30 });
    expect(captured[0]).not.toBe(input);
  }
);

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

void invalidHooks;

test.unit.stable(
  'an uncertain mutation defect remains visible without replay',
  async ({ rpcTestTransport, renderHook, act, expect }) => {
    const defect = new Error('Remote mutation defect');
    let calls = 0;
    const fixture = rpcTestTransport(async () => undefined);
    const transport: ProtocolTransport = {
      ...fixture.transport,
      execute: () =>
        Effect.suspend(() => {
          calls++;

          return Effect.die(defect);
        })
    };
    const view = renderHook(() => rpc.notes.rename.useMutation(), {
      wrapper: ({ children }) => <RpcProvider transport={transport}>{children}</RpcProvider>
    });

    await act(async () => {
      await expect(
        view.result.current.mutateAsync({ id, title: 'Uncertain' })
      ).rejects.toMatchObject({
        _tag: 'MutationDefect',
        cause: defect
      });
    });
    expect(view.result.current.isError).toBe(true);
    const error = view.result.current.error;

    if (error && '_tag' in error && error._tag === 'MutationDefect')
      expect(error.cause).toBe(defect);
    else throw new Error('Expected a typed mutation defect');

    expect(view.result.current.pending).toBe(0);
    view.rerender();
    expect(calls).toBe(1);
  }
);
