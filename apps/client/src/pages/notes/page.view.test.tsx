import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.unit.stable.for(['english', 'italian'] as const)(
  'renders a new draft with the regular notebook layout in %s',
  async (locale, { page, expect, screen, within }) => {
    const { router } = await page.open('/notes?project=9007199254740993', { locale });
    const copy = catalogs[locale];

    expect(await screen.findByRole('heading', { name: copy.Notes })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    const input = await main.findByRole('textbox', { name: copy.NoteCompose });
    const surface = within(input.closest<HTMLElement>('.writing-surface')!);

    expect(input).toBeVisible();
    expect(input).toHaveAttribute('contenteditable', 'true');
    expect(input).toHaveAttribute('data-placeholder', copy.NotePagePlaceholder);
    expect(surface.getByRole('heading', { name: copy.NewNote, level: 1 })).toBeVisible();
    expect(screen.queryByRole('heading', { name: copy.NoteStartTitle })).not.toBeInTheDocument();
    expect(main.queryByRole('heading', { name: copy.NoteAttachments })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: copy.NoteActions })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: copy.NoteSaveNote })).not.toBeInTheDocument();
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
