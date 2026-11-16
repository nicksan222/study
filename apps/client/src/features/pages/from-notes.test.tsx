import { projectIdSchema, noteIdSchema } from '@study/contracts';
import { test } from '@study/testing';

import type * as __MockType0 from './from-notes';

let PagesFromNotes: typeof __MockType0.PagesFromNotes;

let api: ReturnType<typeof createMockState>['api'];

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ notes: mock.fn() }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('#client/features/note-workspace', () => ({
    NotePageDialog: ({
      id,
      notes,
      open
    }: {
      id: bigint;
      notes: { title: string }[];
      open: boolean;
    }) =>
      open ? (
        <section aria-label="Shared transform" data-note={String(id)}>
          {notes.map((note) => note.title).join(', ')}
        </section>
      ) : null
  }));
  const __mockModule0 = await import('./from-notes');

  PagesFromNotes = __mockModule0.PagesFromNotes;
});

test.afterEach(test.cleanup);

test.stable(
  'selects only scoped notes and hands multiple selections to the existing transform dialog',
  async () => {
    const projectId = projectIdSchema.make(2n);
    const note = (id: bigint, title: string, project = projectId) => ({
      id: noteIdSchema.make(id),
      title,
      projectIds: [project],
      titleSource: 'user',
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n
    });

    api.notes.mockResolvedValue([
      note(1n, 'Lecture'),
      note(2n, 'Exercises'),
      note(3n, 'Other subject', projectIdSchema.make(3n))
    ]);
    const harness = test.rpcTestTransport(async (tag) => {
      if (tag === 'notes.notes') return { items: await api.notes(), next: null };

      throw new Error(tag);
    });
    const user = test.userEvent.setup();

    test.render(
      <harness.wrapper>
        <PagesFromNotes project={projectId} />
      </harness.wrapper>
    );
    await user.click(test.screen.getByRole('button', { name: 'PagesFromNotes' }));
    test.expect(test.screen.getByRole('button', { name: 'NoteApplyAction' })).toBeDisabled();
    await user.click(await test.screen.findByRole('button', { name: 'Lecture' }));
    test
      .expect(test.screen.queryByRole('button', { name: 'Other subject' }))
      .not.toBeInTheDocument();
    await user.type(test.screen.getByRole('searchbox', { name: 'PagesFindNotes' }), 'Exercises');
    test.expect(test.screen.queryByRole('button', { name: 'Lecture' })).not.toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: 'Exercises' }));
    await user.click(test.screen.getByRole('button', { name: 'NoteApplyAction' }));
    const transform = await test.screen.findByRole('region', { name: 'Shared transform' });

    test.expect(transform).toHaveAttribute('data-note', '1');
    test.expect(transform).toHaveTextContent('Lecture, Exercises');
  }
);
