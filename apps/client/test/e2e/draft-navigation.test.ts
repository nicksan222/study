import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const scopes = ['River ecology', 'Orchard ecology'].map((name) => ({
  name,
  text: [
    ...Array.from(
      { length: 24 },
      (_, index) =>
        name +
        ' observation ' +
        (index + 1) +
        '. Record the marked trees beside the field path and preserve the original measurements.'
    ),
    name + ' final field observation.'
  ].join('\n\n')
}));

test.browser.stable(
  'Scoped notebook drafts autosave and reopen in their own subjects',
  async ({ page, rpc, expectScreenshot, expect }) => {
    const initial = await rpc.runPromise(rpc.client['settings.workspacePreferences']({}));

    await rpc.runPromise(
      rpc.client['settings.saveWorkspacePreferences']({ ...initial, autosaveIntervalSeconds: 30 })
    );
    const starter = page.getByRole('textbox', { name: copy.NoteCompose });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor });
    const notes = page.getByRole('navigation', { name: copy.Notes, exact: true });
    const practice = page
      .getByRole('navigation', { name: copy.SidebarNavigation })
      .getByRole('link', { name: copy.Practice });
    const saved = new Map<string, string>();

    for (const { name, text } of scopes) {
      const project = await rpc.runPromise(rpc.client['projects.createProject']({ name }));
      const scopePath = '/projects/' + project.id + '/notes';

      await page.goto(scopePath);
      await expect(starter).toBeEditable();
      await expect(notes.getByText(copy.SidebarDraft, { exact: true })).toHaveCount(1);
      await starter.fill(text);
      await expect(page).toHaveURL(new RegExp(scopePath + '/[0-9]+$'));
      await expect(editor).toHaveText(text, { useInnerText: true });
      const notePath = new URL(page.url()).pathname;
      const followup = name + ' follow-up belongs in this notebook.';
      const amended = text + '\n\n' + followup;

      saved.set(name, notePath);
      await editor.fill(amended);
      await expect(editor).toContainText(followup);
      await practice.click();
      await expect(page).toHaveURL(new RegExp('/projects/' + project.id + '/practice$'));
      const listing = await rpc.runPromise(
        rpc.client['notes.notes']({ project: project.id, limit: 10 })
      );

      expect(listing.items).toHaveLength(1);
      const { id } = listing.items[0]!;

      expect(notePath).toBe(scopePath + '/' + id);
      await expect
        .poll(async () => {
          const body = await rpc.runPromise(rpc.client['notes.body']({ noteId: id }));

          return body.text.split(/\n+/);
        })
        .toEqual(amended.split(/\n+/));
    }

    async function reopen(name: string) {
      await page.goto(saved.get(name)!);
      const followup = name + ' follow-up belongs in this notebook.';
      const observation = editor.getByText(followup, { exact: true });

      await expect(editor).toContainText(followup);
      await expect(notes.locator('a[href*="/notes/"]')).toHaveCount(1);
      await observation.scrollIntoViewIfNeeded();

      return observation;
    }

    const riverObservation = await reopen(scopes[0]!.name);

    await expectScreenshot('river-reopened', {
      target: 'viewport',
      ready: () => expect(riverObservation).toBeInViewport()
    });
    const orchardObservation = await reopen(scopes[1]!.name);

    await expectScreenshot('orchard-reopened', {
      target: 'viewport',
      ready: () => expect(orchardObservation).toBeInViewport()
    });
  }
);
