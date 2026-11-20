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
  async ({ page, expectScreenshot, expect }) => {
    const choose = async (control: Locator, label: string) => {
      await control.click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await expect(control).toHaveText(label);
      await expect(control).toBeEnabled();
    };

    await page.goto('/notes?notebookDraft=1');
    const input = page.getByRole('textbox', { name: copy.NoteCompose });
    const save = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });
    const notebook = page.locator('.workspace-desk');
    const timeline = page.locator('.chat-content');

    await input.fill(observation);
    await save.click();
    await expect(page).toHaveURL(/\/notes\/\d+/);
    await expect(timeline).toContainText(observation);
    await expect(notebook).toHaveAttribute('data-content-width', 'full');
    await expectScreenshot('full-width', {
      target: 'viewport',
      ready: () => expect(input).toBeInViewport()
    });
    const fullWidth = (await timeline.boundingBox())!.width;

    const writePage = page.getByRole('button', { name: copy.NoteWritePage, exact: true });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor });

    await writePage.click();
    await expect(editor).toBeEditable();
    await expect(notebook).toHaveAttribute('data-dock', 'side');
    await expect(input).toBeInViewport();
    expect((await editor.boundingBox())!.x).toBeGreaterThan((await input.boundingBox())!.x);
    await expectScreenshot('editor-beside-notebook', {
      target: 'viewport',
      ready: () => expect(editor).toBeInViewport()
    });
    await page.getByRole('button', { name: copy.NoteClosePage, exact: true }).click();
    await expect(editor).toBeHidden();

    const settings = await openAppearance(page);
    const width = settings.getByRole('combobox', { name: copy.AppearanceNoteWidth });
    const always = settings.getByRole('switch', { name: copy.AppearanceNoteComposer });
    const dock = settings.getByRole('combobox', { name: copy.AppearanceNoteEditorDock });
    const close = settings.getByRole('button', { name: copy.Close });

    await expect(width).toHaveText(copy.AppearanceNoteWidthFull);
    await expect(always).toBeChecked();
    await expect(dock).toHaveText(copy.AppearanceNoteEditorDockSide);
    await width.scrollIntoViewIfNeeded();
    await expectScreenshot('appearance', {
      target: settings,
      ready: () => expect(dock).toBeInViewport()
    });
    await choose(width, copy.AppearanceNoteWidthWide);
    await close.click();
    await expect(notebook).toHaveAttribute('data-content-width', 'wide');
    await expectScreenshot('wide', {
      target: 'viewport',
      ready: async () => {
        await expect
          .poll(async () => (await timeline.boundingBox())?.width ?? fullWidth)
          .toBeLessThan(fullWidth);
        await expect(input).toBeInViewport();
      }
    });
    const wideWidth = (await timeline.boundingBox())!.width;

    await openAppearance(page);
    await choose(width, copy.AppearanceNoteWidthComfortable);
    await always.press('Space');
    await expect(always).not.toBeChecked();
    await choose(dock, copy.AppearanceNoteEditorDockBottom);
    await close.click();
    await page.reload();

    const showInput = page.getByRole('button', { name: copy.NoteAddCapture, exact: true });
    const hideInput = page
      .locator('.workspace-desk-capture')
      .getByRole('button', { name: copy.NoteHideCapture, exact: true });

    await expect(notebook).toHaveAttribute('data-content-width', 'comfortable');
    await expect(notebook).toHaveAttribute('data-dock', 'bottom');
    expect((await timeline.boundingBox())!.width).toBeLessThan(wideWidth);
    await expect(input).toBeHidden();
    await expectScreenshot('comfortable-input-hidden', {
      target: 'viewport',
      ready: () => expect(showInput).toBeInViewport()
    });

    await showInput.press('Enter');
    await expect(input).toBeFocused();
    await input.fill('Compare these readings with last week’s survey.');
    await hideInput.press('Space');
    await expect(showInput).toBeFocused();
    await showInput.press('Enter');
    await expect(input).toHaveValue('Compare these readings with last week’s survey.');
    await expectScreenshot('input-open-with-draft', {
      target: 'viewport',
      ready: () => expect(input).toBeFocused()
    });
    await input.press('Control+Enter');
    await expect(timeline).toContainText('Compare these readings with last week’s survey.');

    await showInput.click();
    await writePage.click();

    await expect(editor).toBeEditable();
    await expect(notebook).toHaveAttribute('data-open');
    await editor.fill('River survey report');
    const saved = page.getByRole('status').and(page.getByText(copy.NoteAutosaved, { exact: true }));
    const editorReady = async () => {
      await expect(editor).toHaveText('River survey report');
      await expect(saved).toBeVisible();
    };
    const comfortableEditorWidth = (await editor.boundingBox())!.width;

    await expectScreenshot('editor-below-notebook', {
      target: 'viewport',
      ready: editorReady
    });

    await openAppearance(page);
    await choose(width, copy.AppearanceNoteWidthFull);
    await always.press('Space');
    await expect(always).toBeChecked();
    await close.click();
    await expect(notebook).toHaveAttribute('data-content-width', 'full');
    expect((await editor.boundingBox())!.width).toBeGreaterThan(comfortableEditorWidth);
    await expectScreenshot('editor-full-width', {
      target: 'viewport',
      ready: editorReady
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
