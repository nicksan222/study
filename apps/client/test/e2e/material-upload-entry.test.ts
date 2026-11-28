import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.stable(
  'Upload materials from the subject while note drafts keep their text',
  async ({ page, expect, rpc, expectScreenshot, transferFile }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Fieldwork' })
    );
    const notes = `/projects/${project.id}/notes`;
    const compose = page.getByRole('textbox', { name: copy.NoteCompose, exact: true });
    const editor = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });
    const picker = page.locator('input[type="file"]');
    const fileName = 'samples.txt';

    await page.goto(notes);
    await compose.click();
    await page.keyboard.insertText('Draft observation');
    await expect(page).toHaveURL(/\/notes\/\d+$/);
    await expect(editor).toHaveText('Draft observation');
    const noteUrl = page.url();

    await expect(picker).toHaveCount(0);
    await transferFile(editor, 'drop', fileName);
    const toast = page.getByRole('region', { name: copy.NotificationsLabel });
    const materials = toast.getByRole('button', { name: copy.UploadedMaterials, exact: true });

    await expect(toast.getByText(copy.NoteUploadFromMaterials, { exact: true })).toBeVisible();
    await materials.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/uploads$`));
    await picker.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('Sample counts')
    });
    const library = page.getByRole('navigation', { name: copy.UploadedMaterials });
    const uploaded = library.getByRole('link', { name: fileName, exact: true });

    await uploaded.click();
    await expectScreenshot('subject-material', {
      target: 'viewport',
      ready: async () => {
        await expect(uploaded).toHaveAttribute('aria-current', 'page');
        await expect(
          page.locator('[data-materials-reader]').getByText('Sample counts', { exact: true })
        ).toBeVisible();
      }
    });

    await page.goto(noteUrl);
    await expect(editor).toHaveText('Draft observation');
    await expect(picker).toHaveCount(0);
    await expect(materials).toBeHidden();
    await transferFile(editor, 'paste', fileName);
    await expect(toast.getByText(copy.NoteUploadFromMaterials, { exact: true })).toBeVisible();
    await expect(editor).toHaveText('Draft observation');
    await materials.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/uploads$`));
    await expect(uploaded).toBeVisible();
  }
);
