import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#client/test/render-page.tsx';

testStable.each(['english', 'italian'] as const)(
  'renders a new draft with the regular notebook layout in %s',
  async (locale) => {
    const { router } = renderPage('/notes?project=9007199254740993', locale);
    const copy = catalogs[locale];

    expect(await screen.findByRole('heading', { name: copy.Notes })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: copy.NoteNotesTitle })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    const input = main.getByRole('textbox', { name: copy.NoteCompose });
    const send = main.getByRole('button', { name: copy.NoteSaveNote });

    expect(input).toBeVisible();
    expect(input.closest('section')).toHaveAttribute('data-variant', 'notebook');
    expect(screen.queryByRole('heading', { name: copy.NoteStartTitle })).not.toBeInTheDocument();
    expect(main.getByRole('heading', { name: copy.NoteAttachments })).toBeVisible();
    fireEvent.click(main.getByRole('button', { name: copy.NoteActions }));
    expect(main.queryByRole('heading', { name: copy.NoteAttachments })).not.toBeInTheDocument();
    fireEvent.click(main.getByRole('button', { name: copy.NoteActions }));
    expect(main.getByRole('heading', { name: copy.NoteAttachments })).toBeVisible();
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: 'First note' } });
    await waitFor(() => expect(send).toBeEnabled());
    expect(screen.getByText(copy.NoteNotebookHint)).toBeVisible();
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
