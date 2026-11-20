import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const content = '# Field observations\n\nThree trees were measured at the river bank.';

test.browser.stable(
  'Open original materials from their subject',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const project = await rpc.runPromise(rpc.client['projects.createProject']({ name: 'Ecology' }));
    const other = await rpc.runPromise(rpc.client['projects.createProject']({ name: 'Geometry' }));
    const attachment = await rpc.runPromise(
      rpc.client['sources.createSource']({
        name: 'river-notebook.md',
        bytes: new TextEncoder().encode(content),
        projectId: null
      })
    );

    for (const text of ['First field notebook', 'Second field notebook']) {
      await rpc.runPromise(
        rpc.client['notes.createUntitledNote']({
          project: project.id,
          initialMessage: { text, sourceIds: [attachment.id] }
        })
      );
    }

    await page.goto(`/projects/${other.id}/uploads`);
    await expect(page.getByText(copy.UploadedMaterialsEmpty)).toBeVisible();
    await page.goto(`/projects/${project.id}/notes`);
    const materials = page.getByRole('link', { name: copy.UploadedMaterials, exact: true });

    await materials.focus();
    await materials.press('Enter');
    await expect(page.getByText(attachment.name, { exact: true })).toHaveCount(1);

    await page.locator('input[type="file"]').setInputFiles({
      name: 'standalone.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(content)
    });
    const standalone = page.getByRole('link', { name: /standalone\.md/ });

    await expect(standalone).toContainText(copy.UploadedMaterialsReady);
    expect((await rpc.runPromise(rpc.client['notes.notes']({ limit: 10 }))).items).toHaveLength(2);
    await expectScreenshot('subject-files', {
      target: 'viewport',
      ready: async () => {
        await expect(standalone).toContainText(copy.UploadedMaterialsReady);
        await expect(page.getByRole('link', { name: /river-notebook\.md/ })).toContainText(
          copy.UploadedMaterialsReady
        );
      }
    });
    await standalone.focus();
    await standalone.press('Enter');
    await expect(page.getByRole('heading', { name: 'Field observations' })).toBeVisible();
    const download = page.waitForEvent('download');

    await page.getByRole('button', { name: copy.ReaderOriginal }).click();
    expect((await download).suggestedFilename()).toBe('standalone.md');

    await page.getByRole('link', { name: copy.UploadedMaterialsBack }).click();
    await page.reload();
    await expect(standalone).toBeVisible();
    await expect(page.getByText(attachment.name, { exact: true })).toHaveCount(1);
  }
);
