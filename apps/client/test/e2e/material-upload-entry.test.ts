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

test.browser.stable(
  'Reopen an uploaded file from the subject overview and Materials search',
  async ({ page, expect, rpc, expectScreenshot }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Fieldwork' })
    );
    const subject = `/projects/${project.id}`;
    const fileName = 'river-survey.md';
    const fileText = 'Measure the flow under the footbridge.';
    const edit = page.getByRole('button', { name: copy.MaterialEditFile, exact: true });
    const reader = page.locator('[data-materials-reader]');

    await page.goto(`${subject}/uploads`);
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'text/markdown',
      buffer: Buffer.from(fileText)
    });
    const library = page.getByRole('navigation', { name: copy.UploadedMaterials });
    const material = library.getByRole('link', { name: fileName, exact: true });

    await material.click();
    await expect(reader.getByText(fileText, { exact: true })).toBeVisible();
    const url = page.url();

    await page.goto(subject);
    const sources = page.getByRole('region', { name: copy.UploadedMaterials, exact: true });

    await sources.getByRole('link', { name: new RegExp(fileName) }).click();
    await expect(edit).toBeVisible();
    await expect(page).toHaveURL(url);

    await expectScreenshot('material-reopened', {
      target: 'viewport',
      ready: () => expect(reader.getByText(fileText, { exact: true })).toBeVisible()
    });

    await page.goto(`${subject}/uploads`);
    const search = page.getByRole('searchbox', { name: copy.UploadedMaterialsSearch });
    const empty = library.getByText(copy.SearchNoResults, { exact: true });

    await search.fill('no-such-material');
    await expect(empty).toBeVisible();
    await expect(material).toHaveCount(0);
    await search.fill('river-survey');
    await expect(material).toBeVisible();
    await material.press('Enter');
    await expect(edit).toBeVisible();
    await expect(page).toHaveURL(url);

    await page.getByRole('button', { name: copy.MediaActions, exact: true }).click();
    await page.getByRole('menuitem', { name: copy.SourceDeleteTitle, exact: true }).click();
    const deletion = page.getByRole('alertdialog', { name: copy.SourceDeleteTitle, exact: true });
    const confirm = deletion.getByRole('button', { name: copy.SourceDeleteConfirm, exact: true });

    await expect(confirm).toBeDisabled();
    await deletion.getByRole('textbox', { name: copy.SourceDeleteName }).fill(fileName);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page).toHaveURL(`${subject}/uploads`);
    await expect(material).toHaveCount(0);
    await page.reload();
    await expect(library.getByText(copy.UploadedMaterialsEmpty, { exact: true })).toBeVisible();
  }
);
