import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Option } from 'effect';

test.unit.stable(
  'redirects Home to the note starter with the selected project',
  async ({ page, rpc, waitFor, expect }) => {
    rpc.given({ 'projects.findProject': Option.none() });
    const { router } = await page.open('/home?project=9007199254740993');

    await waitFor(() => expect(router.state.location.pathname).toBe('/notes'));
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);

test.unit.stable.for(['english', 'italian'] as const)(
  'opens the note composer immediately in %s',
  async (locale, { page, expect, screen, within }) => {
    await page.open('/notes', { locale });
    const t = catalogs[locale];

    expect(await screen.findByRole('textbox', { name: t.NoteCompose })).toBeVisible();
    const main = within(screen.getByRole('main'));

    expect(main.getByRole('button', { name: t.NoteSaveNote })).toBeDisabled();
    expect(main.queryByLabelText(t.NoteAttachFiles)).not.toBeInTheDocument();
  }
);
