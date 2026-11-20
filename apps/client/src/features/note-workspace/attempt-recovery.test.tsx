import { StudyError, noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';
import type * as Router from '@tanstack/react-router';
import { Schema } from 'effect';
import { AtomRegistry } from 'effect/reactivity';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

let useAiReadiness: typeof __MockType0.useAiReadiness;

let Composer: typeof __MockType1.Composer;

let composerDraft: typeof __MockType2.composerDraft;

import type * as __MockType0 from '#client/lib/ai-readiness.ts';

import type * as __MockType1 from './composer';
import type * as __MockType2 from './composer.queries';
import type * as NoteQueries from './note-workspace.queries';
import type * as __MockType3 from './note-workspace.queries';
import type * as __MockType5 from './unavailable-attempt';

let ask: typeof __MockType3.ask;

let saveNote: typeof __MockType3.saveNote;

let UnavailableAttempt: typeof __MockType5.UnavailableAttempt;

let reads: ReturnType<typeof createMockState>['reads'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

const id = Schema.decodeUnknownSync(noteIdSchema)(501n);

const clients: AtomRegistry.AtomRegistry[] = [];

function RecoveryProvider({
  registry,
  children,
  rpcTestTransport
}: {
  registry: AtomRegistry.AtomRegistry;
  children: ReactNode;
  rpcTestTransport: Pick<test.unit.Context, 'rpcTestTransport'>['rpcTestTransport'];
}) {
  const fixture = useMemo(
    () =>
      rpcTestTransport(async (tag, input) => {
        if (tag === 'notes.noteSelection') return reads.selection();

        if (tag === 'notes.thread') return reads.thread();

        if (tag === 'notes.noteGenerations') return reads.runs();

        if (tag === 'notes.note') {
          const { id: noteId } = Schema.decodeUnknownSync(Schema.Struct({ id: noteIdSchema }))(
            input
          );

          return {
            id: noteId,
            title: 'Note',
            titleSource: 'user',
            projectIds: [],
            archivedAt: null,
            createdAt: 1n,
            updatedAt: 1n
          };
        }

        throw new StudyError('unsupported', tag);
      }, registry),
    [registry, rpcTestTransport]
  );

  return <fixture.wrapper>{children}</fixture.wrapper>;
}

function mount(
  { render, rpcTestTransport }: Pick<test.unit.Context, 'render' | 'rpcTestTransport'>,
  node: ReactNode,
  client = AtomRegistry.make()
) {
  if (!clients.includes(client)) clients.push(client);

  return {
    client,
    ...render(
      <RecoveryProvider registry={client} rpcTestTransport={rpcTestTransport}>
        {node}
      </RecoveryProvider>
    )
  };
}

function createMockState(mock: test.Mock) {
  return {
    reads: (() => ({
      selection: mock.fn(),
      thread: mock.fn(),
      runs: mock.fn()
    }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  reads = __mockState.reads;

  mock('@tanstack/react-router', async (load) => ({
    ...(await load<typeof Router>()),
    Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>
  }));
  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'english' })
  }));
  mock('#client/features/note-workspace/note-workspace.queries', async (load) => ({
    ...(await load<typeof NoteQueries>()),
    ask: mock.fn(),
    saveNote: mock.fn()
  }));
  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: mock.fn(() => 'ready') }));
  const __mockModule0 = await import('#client/lib/ai-readiness.ts');

  useAiReadiness = __mockModule0.useAiReadiness;
  const __mockModule1 = await import('./composer');

  Composer = __mockModule1.Composer;
  const __mockModule2 = await import('./composer.queries');

  composerDraft = __mockModule2.composerDraft;
  const __mockModule3 = await import('./note-workspace.queries');

  ask = __mockModule3.ask;
  saveNote = __mockModule3.saveNote;

  const __mockModule5 = await import('./unavailable-attempt');

  UnavailableAttempt = __mockModule5.UnavailableAttempt;
});

test.unit.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  vi.mocked(useAiReadiness).mockReturnValue('ready');
  reads.selection.mockResolvedValue({ revision: 8n, targets: [] });
  reads.thread.mockResolvedValue({ items: [], next: null });
  reads.runs.mockResolvedValue({ items: [], next: null });
});
test.unit.afterEach(({ cleanup }) => {
  cleanup();
  clients.splice(0).forEach((client) => client.dispose());
});

test.unit.stable.for(['selection', 'thread', 'runs'] as const)(
  'requires successful %s reconciliation and loses review authorization on remount',
  async (failedRead, { vi, fireEvent, screen, expect, render, rpcTestTransport }) => {
    const abandon = vi.fn();

    reads[failedRead].mockRejectedValueOnce(new StudyError('not_found', 'Unavailable'));
    const node = <UnavailableAttempt id={id} busy={false} onAbandon={abandon} />;
    const first = mount({ render, rpcTestTransport }, node);

    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    expect(abandon).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    expect(reads.selection).toHaveBeenCalledTimes(2);
    expect(reads.thread).toHaveBeenCalledTimes(2);
    expect(reads.runs).toHaveBeenCalledTimes(2);
    expect(abandon).not.toHaveBeenCalled();
    first.unmount();
    const reopened = mount({ render, rpcTestTransport }, node, first.client);

    expect(screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    reopened.rerender(
      <RecoveryProvider registry={first.client} rpcTestTransport={rpcTestTransport}>
        <UnavailableAttempt id={id} busy onAbandon={abandon} />
      </RecoveryProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteAbandonAttempt' }));
    expect(abandon).not.toHaveBeenCalled();
    reopened.rerender(
      <RecoveryProvider registry={first.client} rpcTestTransport={rpcTestTransport}>
        {node}
      </RecoveryProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteAbandonAttempt' }));
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'abandons a retained unavailable Ask after review and resumes plain capture',
  async ({ vi, fireEvent, screen, act, expect, waitFor, render, rpcTestTransport }) => {
    vi.mocked(saveNote).mockResolvedValue({} as Awaited<ReturnType<typeof saveNote>>);
    const first = mount({ render, rpcTestTransport }, <Composer id={id} />);

    act(() =>
      first.client.set(composerDraft(id), {
        text: 'Later draft',
        instruction: '',
        askUnavailable: true,
        askAttempt: {
          noteId: id,
          intentKey: 'retired-ask',
          expectedSelectionRevision: 8n,
          text: 'Original question'
        }
      })
    );
    await screen.findByRole('button', { name: 'NoteReviewUnavailableAttempt' });
    first.unmount();
    mount({ render, rpcTestTransport }, <Composer id={id} />, first.client);
    expect(screen.queryByRole('button', { name: 'NoteAsk' })).toBeNull();
    expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'NoteRetryAsk' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'NoteAbandonAttempt' }));
    expect(screen.getByRole('textbox')).toHaveValue('Later draft');
    await waitFor(() => expect(screen.getByRole('button', { name: 'NoteSaveNote' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'NoteSaveNote' }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledExactlyOnceWith(id, 'Later draft'));
    expect(ask).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'does not authorize abandonment until all reconciliation reads have completed',
  async ({ vi, fireEvent, screen, waitFor, expect, act, render, rpcTestTransport }) => {
    const runs = deferred<{ items: never[]; next: null }>();

    reads.runs.mockReturnValue(runs.promise);
    const abandon = vi.fn();

    mount(
      { render, rpcTestTransport },
      <UnavailableAttempt id={id} busy={false} onAbandon={abandon} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' }));
    await waitFor(() => expect(reads.thread).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'NoteReviewUnavailableAttempt' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'NoteAbandonAttempt' })).toBeNull();
    await act(async () => {
      runs.resolve({ items: [], next: null });
      await runs.promise;
    });
    await screen.findByRole('button', { name: 'NoteAbandonAttempt' });
    expect(abandon).not.toHaveBeenCalled();
  }
);
