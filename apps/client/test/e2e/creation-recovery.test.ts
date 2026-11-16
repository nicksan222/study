import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const original = [
  'Lost receipt field notebook — keep this exact draft.',
  ...Array.from(
    { length: 24 },
    (_, index) =>
      `Observation ${index + 1}. ` +
      'We recorded the shaded river gauge before opening the garden. The reading belongs to this notebook and must survive a lost save receipt. Compare the bridge, the young trees and the morning water level using the original equipment. Retain every detail so the next team can reproduce the observation without guessing.'
  ),
  'FINAL OBSERVATION: one committed notebook, with every original character retained.'
].join('\n\n');

const updated = `${original}\n\nFOLLOW-UP OBSERVATION: the afternoon river gauge rose by two centimetres; compare this changed reading with the retained morning observations before opening the garden tomorrow.`;

test.stable(
  'Recover a committed creation after losing its receipt',
  async ({ page, expectScreenshot, loseCreationResponse }) => {
    await page.goto('/notes');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const save = page.getByRole('button', { name: copy.NoteSaveNote });
    const loss = loseCreationResponse();

    await composer.fill(original);
    await save.click();
    const receipt = await loss.held;
    const savedPath = `/notes/${receipt.note.id}`;
    const savedUrl = new URL(savedPath, page.url()).href;

    await test.expect(save).toBeDisabled();
    await test.expect(save).toHaveAttribute('aria-busy', 'true');
    // Disabled buttons still receive ordinary keyboard attempts without forced activation.
    await save.press('Enter');
    await composer.press('ControlOrMeta+Enter');
    await composer.press('ControlOrMeta+Enter');
    await test.expect(composer).toHaveValue(original);
    await test.expect(page).toHaveURL(/\/notes$/);
    const committed = page
      .getByRole('navigation', { name: copy.Notes })
      .locator(`a[href="${savedPath}"]`);

    await test.expect(committed).toHaveCount(1);
    await composer.press('ControlOrMeta+End');
    await composer.press('PageDown');
    await expectScreenshot('pending-save', {
      target: 'viewport',
      ready: async () => {
        await test.expect(save).toBeDisabled();
        await test.expect(save).toHaveAttribute('aria-busy', 'true');
        await test.expect(committed).toHaveCount(1);
        await test.expect(composer).toHaveValue(original);
      }
    });
    await loss.drop();
    await test.expect(page.getByText(copy.NoteCreationUncertain, { exact: true })).toBeVisible();
    await test.expect(save).toBeDisabled();
    await test.expect(composer).toHaveValue(original);
    await composer.press('ControlOrMeta+Enter');

    // In-app navigation retains the volatile draft and uncertainty fence.
    await page.getByRole('link', { name: copy.SourcePage }).click();
    await test.expect(page).toHaveURL(/\/pages\/?$/);
    await test.expect(composer).toBeHidden();
    await page.goBack();
    await test.expect(page).toHaveURL(/\/notes$/);
    await test.expect(page.getByText(copy.NoteCreationUncertain, { exact: true })).toBeVisible();
    await test.expect(composer).toHaveValue(original);
    await test.expect(save).toBeDisabled();
    const recovery = page.getByRole('region', { name: copy.NoteRecent });

    await recovery.getByRole('button', { name: copy.LibraryRefresh }).click();
    await test
      .expect(recovery.getByRole('button', { name: copy.NoteCreationReviewed }))
      .toBeVisible();
    await test.expect(recovery.locator('a[href^="/notes/"]')).toHaveCount(1);
    const recovered = recovery.locator(`a[href="${savedPath}"]`);

    await test.expect(recovered).toHaveCount(1);
    await expectScreenshot('recovery-prompt', {
      target: 'viewport',
      ready: async () => {
        await test.expect(recovered).toBeVisible();
        await test.expect(save).toBeDisabled();
        await test.expect(composer).toHaveValue(original);
      }
    });
    await recovered.click();
    await test.expect(page).toHaveURL(savedUrl);
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const body = notebook.locator('[data-slot="chat-message-text"]');
    const label = notebook.getByText(copy.NoteEntryNote, { exact: true });
    const entry = notebook.locator('[id*="-message-"]');

    await test.expect(body).toHaveText(original);
    await test.expect(notebook.locator('[data-role="user"]')).toHaveCount(1);
    await entry.focus();
    await test.expect(entry).toBeFocused();
    await label.scrollIntoViewIfNeeded();
    await test.expect(label).toBeInViewport({ ratio: 1 });
    const top = await body.boundingBox();

    for (let step = 0; step < 15; step++) await entry.press('ArrowDown');

    await test.expect.poll(async () => (await body.boundingBox())!.y).toBeLessThan(top!.y);
    await test.expect(label).not.toBeInViewport();
    await entry.press('End');
    await test.expect
      .poll(async () => {
        const end = await entry.boundingBox();
        const dock = await page.locator('.workspace-desk-floating-composer').boundingBox();

        return !!end && !!dock && end.y + end.height <= dock.y;
      })
      .toBe(true);
    await test.expect(composer).toBeInViewport({ ratio: 1 });
    await test.expect(save).toBeInViewport({ ratio: 1 });
    await notebook.locator('[data-role="user"]').hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

    await test.expect(editor).toHaveValue(original);
    await editor.fill(updated);
    await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
    await test.expect(dialog).toBeHidden();
    await test.expect(page).toHaveURL(savedUrl);
    await test.expect(body).toHaveText(updated);
    test.expect(await body.textContent()).toBe(updated);
    await page.reload();
    await test.expect(page).toHaveURL(savedUrl);
    await test.expect(body).toHaveText(updated);
    test.expect(await body.textContent()).toBe(updated);
    await test.expect(entry).toHaveCount(1);
    await test.expect(notebook.locator('[data-role="user"]')).toHaveCount(1);
    await test
      .expect(page.getByRole('navigation', { name: copy.Notes }).locator('a[href^="/notes/"]'))
      .toHaveCount(1);
    await entry.focus();
    await entry.press('End');
    await test.expect(label).not.toBeInViewport();
    await expectScreenshot('reconciled-note', {
      target: 'viewport',
      ready: async () => {
        await test.expect(dialog).toBeHidden();
        await test.expect(page).toHaveURL(savedUrl);
        await test.expect(body).toHaveText(updated);
        test.expect(await body.textContent()).toBe(updated);
        await test.expect(body).toBeInViewport();
        await test.expect(composer).toBeInViewport({ ratio: 1 });
        await test.expect(save).toBeInViewport({ ratio: 1 });
      }
    });
  }
);
