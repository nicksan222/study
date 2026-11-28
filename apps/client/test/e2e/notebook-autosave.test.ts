import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({ video: 'on' });

test.browser.stable(
  'Writes and autosaves a single notebook page',
  async ({ page, expect, expectScreenshot }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/notes');
    const starter = page.getByRole('textbox', { name: copy.NoteCompose });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor });
    const title = page.getByRole('textbox', { name: copy.NoteName });
    const saveNote = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });
    const autosave = page
      .getByRole('status')
      .filter({ hasText: new RegExp(`^${copy.NoteAutosaved}$`) });

    await expect(saveNote).toHaveCount(0);
    await expect(starter).toBeVisible();
    await starter.click({ position: { x: 40, y: 300 } });
    await expect(starter).toBeFocused();
    await page.keyboard.insertText('River field notes');
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('River field notes');
    await expect(saveNote).toHaveCount(0);
    await expectScreenshot('desktop-writing-page', {
      target: 'viewport',
      ready: () => expect(autosave).toBeVisible()
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await title.fill('River field observations and end-of-season measurements');
    await title.press('Enter');
    await expect(title).not.toBeFocused();
    await expect(title).toHaveValue('River field observations and end-of-season measurements');
    await expect.poll(async () => (await title.boundingBox())?.height ?? 0).toBeGreaterThan(60);
    await editor.fill('River field notes revised');
    // Reload while the draft is dirty so local recovery is exercised as well as durable save.
    await page.reload();
    await expect(editor).toHaveText('River field notes revised');
    await expectScreenshot('phone-writing-page', {
      target: 'viewport',
      ready: () => expect(autosave).toBeVisible()
    });
    await page.reload();
    await expect(editor).toHaveText('River field notes revised');

    await editor.fill('');
    await expect(autosave).toBeVisible();
    await page.reload();
    await expect(editor).toHaveText('');
    await expect(saveNote).toHaveCount(0);
  }
);

test.browser.stable(
  'Notebook actions move from the right rail to disclosure and open scoped Practice',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, zoomPercent: 100 }));
    const subject = await rpc.runPromise(rpc.client['projects.createProject']({ name: 'Ecology' }));
    const note = await rpc.runPromise(
      rpc.client['notes.createNote']({ project: subject.id, title: 'Wetland survey' })
    );
    const draft = 'Record water levels on both sides of the bridge.';

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/notes/${note.id}`);
    const toggle = page.getByRole('button', { name: copy.NoteActions, exact: true });
    const actions = page.getByRole('complementary', { name: copy.NoteContextPanel, exact: true });
    const practice = actions.getByRole('link', { name: copy.PracticeStudyNotes, exact: true });
    const heading = actions.getByRole('heading', { name: copy.NoteActions, exact: true });
    const title = page.getByRole('textbox', { name: copy.NoteName, exact: true });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });

    await expect(page.locator('.study-workspace-header').getByText('Ecology')).toBeVisible();
    await expect(title).toHaveValue('Wetland survey');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(heading).toBeVisible();
    await expect(practice).toBeVisible();
    await editor.fill('Wetland observations');
    await expect
      .poll(async () => {
        const [writing, rail] = await Promise.all([editor.boundingBox(), actions.boundingBox()]);

        return !!writing && !!rail && writing.x + writing.width <= rail.x;
      })
      .toBe(true);
    await expectScreenshot('desktop-right-rail', {
      target: 'viewport',
      zoomPercent: 100,
      ready: async () => {
        await expect(practice).toBeInViewport();
        await expect(page.getByText(copy.NoteAutosaved, { exact: true })).toBeVisible();
      }
    });

    await editor.fill(draft);
    await practice.focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(editor).toHaveText(draft);
    await expect(title).toHaveValue('Wetland survey');
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(heading).toBeInViewport();
    await expect(practice).toBeInViewport();
    await expect
      .poll(async () => (await practice.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);

    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(title).toBeVisible();
    await practice.focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[inert]').filter({ has: title })).toHaveCount(1);
    await title.focus();
    await expect(practice).toBeFocused();

    await actions.getByRole('button', { name: copy.NoteHistory, exact: true }).click();
    const back = page.getByRole('button', { name: copy.NoteBackToEditor, exact: true });

    await expect(back).toBeFocused();
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await practice.focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await back.press('Enter');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText(draft);
    await toggle.press('Enter');

    await page.setViewportSize({ width: 860, height: 320 });
    const remove = actions.getByRole('button', { name: copy.NoteDelete, exact: true });

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await remove.scrollIntoViewIfNeeded();
    await expect(remove).toBeInViewport({ ratio: 1 });
    await remove.focus();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(editor).toHaveText(draft);
    await expect(page.getByText(copy.NoteAutosaved, { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await toggle.press('Enter');
    await practice.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${subject.id}/practice$`));
    await expect(
      page.getByRole('heading', { name: copy.PagesOverviewTitle, exact: true })
    ).toBeVisible();
  }
);
