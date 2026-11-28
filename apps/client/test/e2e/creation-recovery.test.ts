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
  async ({ page, expectScreenshot, loseCreationResponse, placeCaretAtEnd, expect }) => {
    await page.goto('/notes');
    const starter = page.getByRole('textbox', { name: copy.NoteCompose });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor });
    const noteLinks = page
      .getByRole('navigation', { name: copy.Notes })
      .locator('a[href^="/notes/"]');
    const pending = page.getByRole('status').filter({ hasText: copy.NoteAutosaving });
    const uncertainty = page.getByText(copy.NoteCreationUncertain, { exact: true });
    const loss = loseCreationResponse();

    await starter.fill(original);
    const receipt = await loss.held;
    const savedPath = `/notes/${receipt.note.id}`;
    const savedUrl = new URL(savedPath, page.url()).href;
    const committed = page
      .getByRole('navigation', { name: copy.Notes })
      .locator(`a[href="${savedPath}"]`);

    await expect(committed).toHaveCount(1);
    await expect(noteLinks).toHaveCount(1);
    await expect(page).toHaveURL(/\/notes$/);
    await expectScreenshot('pending-save', {
      target: 'viewport',
      ready: async () => {
        await expect(pending).toBeVisible();
        await expect(starter).toHaveText(original, { useInnerText: true });
      }
    });

    await starter.fill(updated);
    await loss.drop();
    await expect(uncertainty).toBeVisible();
    await expect(starter).toHaveText(updated, { useInnerText: true });

    await page.getByRole('link', { name: copy.Practice }).click();
    await expect(page).toHaveURL(/\/practice\/?$/);
    await expect(
      page.getByRole('heading', { name: copy.PracticeStudyNotesTitle, exact: true })
    ).toBeVisible();
    await expect(starter).toBeHidden();
    await page.goBack();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(uncertainty).toBeVisible();
    await expect(starter).toHaveText(updated, { useInnerText: true });

    const recovery = page.getByRole('region', { name: copy.NoteRecent });

    await recovery.getByRole('button', { name: copy.LibraryRefresh }).click();
    await expect(recovery.getByRole('button', { name: copy.NoteCreationReviewed })).toBeVisible();
    await expect(recovery.locator('a[href^="/notes/"]')).toHaveCount(1);
    const recovered = recovery.locator(`a[href="${savedPath}"]`);

    await expectScreenshot('recovery-prompt', {
      target: 'viewport',
      ready: async () => {
        await expect(recovered).toBeVisible();
        await expect(noteLinks).toHaveCount(1);
        await expect(starter).toHaveText(updated, { useInnerText: true });
      }
    });
    await recovered.click();
    await expect(page).toHaveURL(savedUrl);
    await expect(editor).toHaveText(original, { useInnerText: true });
    await editor.fill(updated);
    await expect(page.getByRole('status').filter({ hasText: copy.NoteAutosaved })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(savedUrl);
    await expect(editor).toHaveText(updated, { useInnerText: true });
    await expect(noteLinks).toHaveCount(1);
    await expect(committed).toHaveCount(1);
    await placeCaretAtEnd(editor);
    await editor.getByText(updated.split('\n\n').at(-1)!, { exact: true }).scrollIntoViewIfNeeded();
    await expectScreenshot('reconciled-note', {
      target: 'viewport',
      ready: async () => {
        await expect(editor).toHaveText(updated, { useInnerText: true });
        await expect(
          page.getByText(updated.split('\n\n').at(-1)!, { exact: true })
        ).toBeInViewport();
      }
    });
  }
);
