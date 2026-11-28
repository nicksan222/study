import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type { Locator, Page } from 'playwright';

test.browser.use({ useDefaultNoteAppearance: true, video: 'on' });

const copy = catalogs.english;

const italian = catalogs.italian;

const observation =
  'At the river survey, we measured the water level at both ends of the bridge. ' +
  'We repeated each reading three times and left a marker on the bank for next week’s comparison.';

async function openAppearance(page: Page) {
  await page.getByRole('button', { name: copy.Settings, exact: true }).click();

  return page.getByRole('dialog', { name: copy.Settings });
}

test.browser.stable(
  'Note appearance controls persist across reload',
  async ({ page, rpc, expectScreenshot, expect }) => {
    const choose = async (control: Locator, label: string) => {
      await control.click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await expect(control).toHaveText(label);
      await expect(control).toBeEnabled();
    };

    const { id } = await rpc.runPromise(rpc.client['notes.createNote']({ title: 'River survey' }));

    await page.goto('/notes/' + id);
    const notebook = page.locator('.workspace-desk');
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor });

    await expect(editor).toBeEditable();
    await expect(notebook).toHaveAttribute('data-content-width', 'full');
    await editor.fill(observation);
    await expect(
      page.getByRole('status').and(page.getByText(copy.NoteAutosaved, { exact: true }))
    ).toBeVisible();
    await expectScreenshot('full-width', {
      target: 'viewport',
      ready: () => expect(editor).toBeInViewport()
    });
    const fullWidth = (await editor.boundingBox())!.width;
    const settings = await openAppearance(page);
    const width = settings.getByRole('combobox', { name: copy.AppearanceNoteWidth });
    const dock = settings.getByRole('combobox', { name: copy.AppearanceNoteEditorDock });
    const close = settings.getByRole('button', { name: copy.Close });

    await expect(width).toHaveText(copy.AppearanceNoteWidthFull);
    await expect(dock).toHaveText(copy.AppearanceNoteEditorDockSide);
    await choose(width, copy.AppearanceNoteWidthWide);
    await close.click();
    await expect(notebook).toHaveAttribute('data-content-width', 'wide');
    expect((await editor.boundingBox())!.width).toBeLessThan(fullWidth);
    const wideWidth = (await editor.boundingBox())!.width;

    await openAppearance(page);
    await choose(width, copy.AppearanceNoteWidthComfortable);
    await choose(dock, copy.AppearanceNoteEditorDockBottom);
    await close.click();
    await page.reload();

    await expect(notebook).toHaveAttribute('data-content-width', 'comfortable');
    await expect(notebook).toHaveAttribute('data-dock', 'bottom');
    await expect(editor).toHaveText(observation);
    expect((await editor.boundingBox())!.width).toBeLessThan(wideWidth);
    await expectScreenshot('comfortable-width', {
      target: 'viewport',
      ready: () => expect(editor).toBeInViewport()
    });

    await openAppearance(page);
    await settings.getByRole('button', { name: copy.GeneralSettingsTitle, exact: true }).click();
    await settings.getByRole('combobox', { name: copy.GeneralSettingsLanguage }).click();
    await page.getByRole('option', { name: copy.ItalianOwnName, exact: true }).click();

    const localized = page.getByRole('dialog', { name: italian.Settings });

    await expect(
      localized.getByRole('combobox', { name: italian.GeneralSettingsLanguage })
    ).toHaveText(italian.ItalianOwnName);
    await localized.getByRole('button', { name: italian.Appearance, exact: true }).click();
    await page.setViewportSize({ width: 720, height: 800 });
    const localizedDock = localized.getByRole('combobox', {
      name: italian.AppearanceNoteEditorDock
    });

    await localizedDock.scrollIntoViewIfNeeded();
    await expectScreenshot('appearance-italian-narrow', {
      target: localized,
      ready: () => expect(localizedDock).toHaveText(italian.AppearanceNoteEditorDockBottom)
    });
  }
);
