import { projectIdSchema, noteIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vite-plus/test';

import { PagesFromNotes } from './from-notes';

const api = vi.hoisted(() => ({ notes: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('#client/lib/study-client/study.queries.ts', () => ({
  notesQueryOptions: () => ({ queryKey: ['notes'], queryFn: api.notes })
}));
vi.mock('../note-workspace', () => ({
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

afterEach(cleanup);

testStable(
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
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={cache}>
        <PagesFromNotes project={projectId} />
      </QueryClientProvider>
    );
    await user.click(screen.getByRole('button', { name: 'PagesFromNotes' }));
    expect(screen.getByRole('button', { name: 'NoteApplyAction' })).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: 'Lecture' }));
    expect(screen.queryByRole('button', { name: 'Other subject' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'PagesFindNotes' }), 'Exercises');
    expect(screen.queryByRole('button', { name: 'Lecture' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exercises' }));
    await user.click(screen.getByRole('button', { name: 'NoteApplyAction' }));
    const transform = await screen.findByRole('region', { name: 'Shared transform' });

    expect(transform).toHaveAttribute('data-note', '1');
    expect(transform).toHaveTextContent('Lecture, Exercises');
    cache.clear();
  }
);
