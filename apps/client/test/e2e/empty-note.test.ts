import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.stable(
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
        await test.expect(control).toBeInViewport({ ratio: 1 });

        const box = await control.boundingBox();

        test.expect(box).not.toBeNull();

        if (!box) throw new Error('Composer control has no layout box');

        test.expect(box.x).toBeGreaterThanOrEqual(0);
        test.expect(box.y).toBeGreaterThanOrEqual(0);
        test.expect(box.x + box.width).toBeLessThanOrEqual(2560);
        test.expect(box.y + box.height).toBeLessThanOrEqual(1440);
      }

      await composer.click({ trial: true });
      await attach.click({ trial: true });

      const inputBox = await composer.boundingBox();
      const saveBox = await save.boundingBox();

      if (!inputBox || !saveBox) throw new Error('Composer controls have no layout boxes');

      test.expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(saveBox.y);

      if (await save.isEnabled()) await save.click({ trial: true });
    }

    async function invalidDraft() {
      await test.expect(save).toBeDisabled();
      await test.expect(save).not.toHaveAttribute('aria-busy', 'true');
      await composer.press('Control+Enter');
      await test.expect(page).toHaveURL(/\/notes$/);
      await test.expect(noteLinks).toHaveCount(0);
      await test.expect(page.getByRole('article')).toHaveCount(0);
      await test.expect(save).toBeDisabled();
      await test.expect(save).not.toHaveAttribute('aria-busy', 'true');
      await test.expect(composer).toHaveAccessibleDescription(copy.NoteNotebookHint);
      await reachableControls();
    }

    await page.goto('/notes');
    await test.expect(composer).toHaveValue('');
    await invalidDraft();
    await expectScreenshot('empty-validation', {
      target: 'viewport',
      ready: async () => {
        await test.expect(save).toBeDisabled();
        await test.expect(page.getByText(copy.NoteNotebookHint, { exact: true })).toBeVisible();
      }
    });

    for (let cycle = 1; cycle <= 5; cycle++) {
      await composer.fill(`Observation draft ${cycle}: waiting for the measured river level.`);
      await test.expect(save).toBeEnabled();
      await test.expect(save).not.toHaveAttribute('aria-busy', 'true');
      await reachableControls();
      await composer.fill(' \n ');
      await test.expect(composer).toHaveValue(' \n ');
      await invalidDraft();
    }

    await expectScreenshot('whitespace-validation', {
      target: 'viewport',
      ready: async () => {
        await test.expect(composer).toHaveValue(' \n ');
        await test.expect(save).toBeDisabled();
        await test.expect(noteLinks).toHaveCount(0);
      }
    });

    await composer.fill(content);
    await test.expect(save).toBeEnabled();
    await composer.press('Control+Home');
    await reachableControls();
    await composer.press('Control+End');
    await composer.press('End');
    await composer.press('!');

    const corrected = `${content}!`;

    await test.expect(composer).toHaveValue(corrected);
    await reachableControls();
    await expectScreenshot('corrected-draft', {
      target: 'viewport',
      ready: () => test.expect(composer).toHaveValue(corrected)
    });
    await composer.press('Control+Enter');
    await test.expect(page).toHaveURL(/\/notes\/[^/?]+$/);

    const identity = page.url();
    const text = page.locator('[data-slot="chat-message-text"]');
    const scrollHost = page.locator('[data-notebook-scroll-host]');

    await test.expect(text).toHaveCount(1);
    test.expect(await text.textContent()).toBe(corrected);
    await test.expect(noteLinks).toHaveCount(1);
    await test.expect(composer).toHaveValue('');
    await reachableControls();

    const entryLabel = page.getByText(copy.NoteEntryNote, { exact: true });

    await entryLabel.scrollIntoViewIfNeeded();
    await test.expect(entryLabel).toBeInViewport({ ratio: 1 });
    await test.expect.poll(async () => (await text.boundingBox())?.y).toBeGreaterThan(0);

    const top = await text.boundingBox();

    if (!top) throw new Error('Saved note has no layout box');

    await scrollHost.press('End');
    await test.expect(entryLabel).not.toBeInViewport();
    await test.expect.poll(async () => (await text.boundingBox())?.y).toBeLessThan(top.y);
    await test.expect
      .poll(async () => {
        const noteBox = await text.boundingBox();
        const composerBox = await page.locator('.workspace-desk-floating-composer').boundingBox();

        return noteBox && composerBox ? composerBox.y - (noteBox.y + noteBox.height) : -1;
      })
      .toBeGreaterThan(0);
    await reachableControls();
    await composer.click();
    await test.expect(composer).toBeFocused();
    await expectScreenshot('corrected-saved', {
      target: 'viewport',
      ready: async () => {
        test.expect(await text.textContent()).toBe(corrected);
        await test.expect(save).toBeDisabled();
      }
    });

    await page.goto('/notes');
    await test.expect(noteLinks).toHaveCount(1);
    await noteLinks.click();
    await test.expect(page).toHaveURL(identity);
    test.expect(await text.textContent()).toBe(corrected);
    await page.reload();
    await test.expect(page).toHaveURL(identity);
    await test.expect(text).toHaveCount(1);
    await test.expect(text).toHaveText(corrected);
    test.expect(await text.textContent()).toBe(corrected);
    await page.goto('/notes');
    await page.reload();
    await test.expect(noteLinks).toHaveCount(1);
    await noteLinks.click();
    await test.expect(page).toHaveURL(identity);
    await test.expect(text).toHaveText(corrected);
  }
);
