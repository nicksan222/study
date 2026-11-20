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

test.browser.stable(
  'Recover a committed creation after losing its receipt',
  async ({ page, expectScreenshot, loseCreationResponse, expect }) => {
    await page.goto('/notes?notebookDraft=1');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const save = page.getByRole('button', { name: copy.NoteSaveNote });
    const loss = loseCreationResponse();

    await composer.fill(original);
    await save.click();
    const receipt = await loss.held;
    const savedPath = `/notes/${receipt.note.id}`;
    const savedUrl = new URL(savedPath, page.url()).href;

    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('aria-busy', 'true');
    const opening = page.getByRole('status').filter({ hasText: copy.NoteStarting });
    const captureBox = await page.getByRole('region', { name: copy.NoteCompose }).boundingBox();
    const openingBox = await opening.boundingBox();

    if (!captureBox || !openingBox) throw new Error('The pending capture has no layout box');

    expect(openingBox.x).toBeGreaterThanOrEqual(captureBox.x);
    expect(openingBox.x + openingBox.width).toBeLessThanOrEqual(captureBox.x + captureBox.width);
    // Disabled buttons still receive ordinary keyboard attempts without forced activation.
    await save.press('Enter');
    await composer.press('ControlOrMeta+Enter');
    await composer.press('ControlOrMeta+Enter');
    await expect(composer).toHaveValue(original);
    await expect(page).toHaveURL(/\/notes\?notebookDraft=1$/);
    const committed = page
      .getByRole('navigation', { name: copy.Notes })
      .locator(`a[href="${savedPath}"]`);

    await expect(committed).toHaveCount(1);
    await composer.press('ControlOrMeta+End');
    await composer.press('PageDown');
    await expectScreenshot('pending-save', {
      target: 'viewport',
      ready: async () => {
        await expect(save).toBeDisabled();
        await expect(save).toHaveAttribute('aria-busy', 'true');
        await expect(committed).toHaveCount(1);
        await expect(composer).toHaveValue(original);
      }
    });
    await loss.drop();
    await expect(page.getByText(copy.NoteCreationUncertain, { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(composer).toHaveValue(original);
    await composer.press('ControlOrMeta+Enter');

    // In-app navigation retains the volatile draft and uncertainty fence.
    await page.getByRole('link', { name: copy.Documents }).click();
    await expect(page).toHaveURL(/\/notes\/?$/);
    await expect(composer).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(/\/notes\?notebookDraft=1$/);
    await expect(page.getByText(copy.NoteCreationUncertain, { exact: true })).toBeVisible();
    await expect(composer).toHaveValue(original);
    await expect(save).toBeDisabled();
    const recovery = page.getByRole('region', { name: copy.NoteRecent });

    await recovery.getByRole('button', { name: copy.LibraryRefresh }).click();
    await expect(recovery.getByRole('button', { name: copy.NoteCreationReviewed })).toBeVisible();
    await expect(recovery.locator('a[href^="/notes/"]')).toHaveCount(1);
    const recovered = recovery.locator(`a[href="${savedPath}"]`);

    await expect(recovered).toHaveCount(1);
    await expectScreenshot('recovery-prompt', {
      target: 'viewport',
      ready: async () => {
        await expect(recovered).toBeVisible();
        await expect(save).toBeDisabled();
        await expect(composer).toHaveValue(original);
      }
    });
    await recovered.click();
    await expect(page).toHaveURL(savedUrl);
    const notebook = page.getByRole('region', { name: copy.NoteNotebook });
    const body = notebook.locator('[data-slot="chat-message-text"]');
    const label = body;
    const entry = notebook.locator('[id*="-message-"]');

    await expect(body).toHaveText(original);
    await expect(notebook.locator('[data-role="user"]')).toHaveCount(1);
    await entry.focus();
    await expect(entry).toBeFocused();
    await page
      .getByRole('navigation', { name: copy.NoteOutline })
      .getByRole('button')
      .first()
      .click();
    await expect(label).toHaveVisibleText(original.split('\n')[0]!);
    const top = await body.boundingBox();

    for (let step = 0; step < 15; step++) await entry.press('ArrowDown');

    await expect.poll(async () => (await body.boundingBox())!.y).toBeLessThan(top!.y);
    await expect(label).not.toHaveVisibleText(original.split('\n')[0]!);
    await entry.press('End');
    await expect
      .poll(async () => {
        const end = await entry.boundingBox();
        const capture = await page.locator('.workspace-desk-capture').boundingBox();

        return !!end && !!capture && end.y + end.height <= capture.y;
      })
      .toBe(true);
    await expect(composer).toBeHidden();
    await expect(
      page.getByRole('button', { name: copy.NoteAddCapture, exact: true })
    ).toBeInViewport({ ratio: 1 });
    await expect(save).toBeHidden();
    await notebook.locator('[data-role="user"]').hover();
    await page.getByRole('button', { name: copy.NoteEditNote }).click();
    const dialog = page.getByRole('dialog', { name: copy.NoteEditNote });

    await dialog.getByRole('button', { name: copy.NoteMarkdownSource, exact: true }).click();
    const editor = dialog.getByRole('textbox', { name: copy.NoteEditNote });

    await expect(editor).toHaveValue(original);
    await editor.fill(updated);
    await expectScreenshot('recovered-edit-draft', {
      target: dialog,
      ready: () => expect(editor).toHaveValue(updated)
    });
    await dialog.getByRole('button', { name: copy.NoteSaveNote }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(savedUrl);
    await expect(body).toHaveText(updated);
    expect(await body.textContent()).toBe(updated);
    await page.reload();
    await expect(page).toHaveURL(savedUrl);
    await expect(body).toHaveText(updated);
    expect(await body.textContent()).toBe(updated);
    await expect(entry).toHaveCount(1);
    await expect(notebook.locator('[data-role="user"]')).toHaveCount(1);
    await expect(
      page.getByRole('navigation', { name: copy.Notes }).locator('a[href^="/notes/"]')
    ).toHaveCount(1);
    await entry.focus();
    await entry.press('End');
    await expect(label).not.toHaveVisibleText(original.split('\n')[0]!);
    await expectScreenshot('reconciled-note', {
      target: 'viewport',
      ready: async () => {
        await expect(dialog).toBeHidden();
        await expect(page).toHaveURL(savedUrl);
        await expect(body).toHaveText(updated);
        expect(await body.textContent()).toBe(updated);
        await expect(body).toBeInViewport();
        await expect(composer).toBeHidden();
        await expect(
          page.getByRole('button', { name: copy.NoteAddCapture, exact: true })
        ).toBeInViewport({ ratio: 1 });
        await expect(save).toBeHidden();
      }
    });
  }
);
