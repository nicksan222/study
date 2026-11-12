import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

const copy = catalogs.english;

testE2e(
  'Empty note drafts recover without creating notebooks',
  async ({ page, expectScreenshot }) => {
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const save = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });
    const attach = page.getByTitle(copy.NoteAttachFiles, { exact: true });
    const noteLinks = page.locator('a[href^="/notes/"]');
    const content = [
      'Recovered field observations',
      ...Array.from(
        { length: 24 },
        (_, index) =>
          `Observation ${index + 1}: record the river level before comparing the daily measurements.\nKeep the original reading so the next survey can explain any change.`
      ),
      'Final observation: the corrected draft is complete.'
    ].join('\n\n');

    async function reachableControls() {
      for (const control of [composer, attach, save]) {
        await expect(control).toBeInViewport({ ratio: 1 });

        const box = await control.boundingBox();

        expect(box).not.toBeNull();

        if (!box) throw new Error('Composer control has no layout box');

        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(2560);
        expect(box.y + box.height).toBeLessThanOrEqual(1440);
      }

      await composer.click({ trial: true });
      await attach.click({ trial: true });

      const inputBox = await composer.boundingBox();
      const saveBox = await save.boundingBox();

      if (!inputBox || !saveBox) throw new Error('Composer controls have no layout boxes');

      expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(saveBox.y);

      if (await save.isEnabled()) await save.click({ trial: true });
    }

    async function invalidDraft() {
      await expect(save).toBeDisabled();
      await expect(save).not.toHaveAttribute('aria-busy', 'true');
      await composer.press('Control+Enter');
      await expect(page).toHaveURL(/\/notes$/);
      await expect(noteLinks).toHaveCount(0);
      await expect(page.getByRole('article')).toHaveCount(0);
      await expect(save).toBeDisabled();
      await expect(save).not.toHaveAttribute('aria-busy', 'true');
      await expect(composer).toHaveAccessibleDescription(copy.NoteNotebookHint);
      await reachableControls();
    }

    await page.goto('/notes');
    await expect(composer).toHaveValue('');
    await invalidDraft();
    await expectScreenshot('empty-validation', {
      target: 'viewport',
      ready: async () => {
        await expect(save).toBeDisabled();
        await expect(page.getByText(copy.NoteNotebookHint, { exact: true })).toBeVisible();
      }
    });

    for (let cycle = 1; cycle <= 5; cycle++) {
      await composer.fill(`Observation draft ${cycle}: waiting for the measured river level.`);
      await expect(save).toBeEnabled();
      await expect(save).not.toHaveAttribute('aria-busy', 'true');
      await reachableControls();
      await composer.fill(' \n ');
      await expect(composer).toHaveValue(' \n ');
      await invalidDraft();
    }

    await expectScreenshot('whitespace-validation', {
      target: 'viewport',
      ready: async () => {
        await expect(composer).toHaveValue(' \n ');
        await expect(save).toBeDisabled();
        await expect(noteLinks).toHaveCount(0);
      }
    });

    await composer.fill(content);
    await expect(save).toBeEnabled();
    await composer.press('Control+Home');
    await reachableControls();
    await composer.press('Control+End');
    await composer.press('End');
    await composer.press('!');

    const corrected = `${content}!`;

    await expect(composer).toHaveValue(corrected);
    await reachableControls();
    await expectScreenshot('corrected-draft', {
      target: 'viewport',
      ready: () => expect(composer).toHaveValue(corrected)
    });
    await composer.press('Control+Enter');
    await expect(page).toHaveURL(/\/notes\/[^/?]+$/);

    const identity = page.url();
    const text = page.locator('[data-slot="chat-message-text"]');
    const scrollHost = page.locator('[data-notebook-scroll-host]');

    await expect(text).toHaveCount(1);
    expect(await text.textContent()).toBe(corrected);
    await expect(noteLinks).toHaveCount(1);
    await expect(composer).toHaveValue('');
    await reachableControls();

    const entryLabel = page.getByText(copy.NoteEntryNote, { exact: true });

    await entryLabel.scrollIntoViewIfNeeded();
    await expect(entryLabel).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => (await text.boundingBox())?.y).toBeGreaterThan(0);

    const top = await text.boundingBox();

    if (!top) throw new Error('Saved note has no layout box');

    await scrollHost.press('End');
    await expect(entryLabel).not.toBeInViewport();
    await expect.poll(async () => (await text.boundingBox())?.y).toBeLessThan(top.y);
    await expect
      .poll(async () => {
        const noteBox = await text.boundingBox();
        const composerBox = await page.locator('.workspace-desk-floating-composer').boundingBox();

        return noteBox && composerBox ? composerBox.y - (noteBox.y + noteBox.height) : -1;
      })
      .toBeGreaterThan(0);
    await reachableControls();
    await composer.click();
    await expect(composer).toBeFocused();
    await expectScreenshot('corrected-saved', {
      target: 'viewport',
      ready: async () => {
        expect(await text.textContent()).toBe(corrected);
        await expect(save).toBeDisabled();
      }
    });

    await page.goto('/notes');
    await expect(noteLinks).toHaveCount(1);
    await noteLinks.click();
    await expect(page).toHaveURL(identity);
    expect(await text.textContent()).toBe(corrected);
    await page.reload();
    await expect(page).toHaveURL(identity);
    await expect(text).toHaveCount(1);
    await expect(text).toHaveText(corrected);
    expect(await text.textContent()).toBe(corrected);
    await page.goto('/notes');
    await page.reload();
    await expect(noteLinks).toHaveCount(1);
    await noteLinks.click();
    await expect(page).toHaveURL(identity);
    await expect(text).toHaveText(corrected);
  }
);
