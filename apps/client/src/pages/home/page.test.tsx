import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Option } from 'effect';

test.stable(
  'redirects Home to the note starter with the selected project',
  async ({ page, rpc }) => {
    rpc.given({ 'projects.findProject': Option.none() });
    const { router } = await page.open('/home?project=9007199254740993');

    await test.waitFor(() => test.expect(router.state.location.pathname).toBe('/notes'));
    test.expect(router.state.location.search.project).toBe('9007199254740993');
  }
);

test.stable.for(['english', 'italian'] as const)(
  'opens the note composer immediately in %s',
  async (locale, { page }) => {
    await page.open('/notes', { locale });
    const t = catalogs[locale];

    test.expect(await test.screen.findByRole('textbox', { name: t.NoteCompose })).toBeVisible();
    const main = test.within(test.screen.getByRole('main'));

    test.expect(main.getByRole('button', { name: t.NoteSaveNote })).toBeDisabled();
    test.expect(main.getByLabelText(t.NoteAttachFiles)).toBeInTheDocument();
  }
);
