import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.stable.for(['english', 'italian'] as const)(
  'renders a new draft with the regular notebook layout in %s',
  async (locale, { page }) => {
    const { router } = await page.open('/notes?project=9007199254740993', { locale });
    const copy = catalogs[locale];

    test.expect(await test.screen.findByRole('heading', { name: copy.Notes })).toBeInTheDocument();
    test
      .expect(await test.screen.findByRole('heading', { name: copy.NoteNotesTitle }))
      .toBeInTheDocument();
    const main = test.within(test.screen.getByRole('main'));
    const input = main.getByRole('textbox', { name: copy.NoteCompose });
    const send = main.getByRole('button', { name: copy.NoteSaveNote });

    test.expect(input).toBeVisible();
    test.expect(input.closest('section')).toHaveAttribute('data-variant', 'notebook');
    test
      .expect(test.screen.queryByRole('heading', { name: copy.NoteStartTitle }))
      .not.toBeInTheDocument();
    test.expect(main.getByRole('heading', { name: copy.NoteAttachments })).toBeVisible();
    test.fireEvent.click(main.getByRole('button', { name: copy.NoteActions }));
    test
      .expect(main.queryByRole('heading', { name: copy.NoteAttachments }))
      .not.toBeInTheDocument();
    test.fireEvent.click(main.getByRole('button', { name: copy.NoteActions }));
    test.expect(main.getByRole('heading', { name: copy.NoteAttachments })).toBeVisible();
    test.expect(send).toBeDisabled();
    test.fireEvent.change(input, { target: { value: 'First note' } });
    await test.waitFor(() => test.expect(send).toBeEnabled());
    test.expect(test.screen.getByText(copy.NoteNotebookHint)).toBeVisible();
    test.expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
