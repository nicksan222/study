import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const workbook = new URL(
  '../../../../tooling/scripts/seed/fixtures/files/mitosis/counts.xlsx',
  import.meta.url
);

test.browser.stable(
  'Read extracted Excel sheets and download the workbook in Materials',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Cell biology' })
    );
    const bytes = await Bun.file(workbook).bytes();
    const source = await rpc.runPromise(
      rpc.client['sources.createSource']({ projectId: project.id, name: 'Counts.xlsx', bytes })
    );
    const path = `/projects/${project.id}/sources/${source.id}?fromUploads=1`;

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    const reader = page.locator('[data-materials-reader]');
    const extracted = reader.getByRole('button', { name: copy.UploadedMaterialsText, exact: true });

    await expect(extracted).toHaveAttribute('aria-pressed', 'true');
    await expect(reader.getByRole('heading', { name: 'Conteggio' })).toBeVisible();
    await expect(reader.getByRole('heading', { name: 'Preparati' })).toBeVisible();
    await expect(reader.getByRole('cell', { name: 'Profase', exact: true })).toBeVisible();
    await expect(reader.getByRole('cell', { name: 'Apice radicale' }).first()).toBeVisible();
    await expect(reader.getByRole('button', { name: copy.MaterialPreview })).toHaveCount(0);

    const pending = page.waitForEvent('download');

    await reader.getByRole('button', { name: copy.ReaderOriginal, exact: true }).press('Enter');
    const file = await pending;

    expect(file.suggestedFilename()).toBe(source.name);
    expect(await Bun.file(await file.path()).bytes()).toEqual(bytes);
    await expect(page).toHaveURL(new URL(path, page.url()).href);
    await expectScreenshot('extracted-worksheets', {
      target: 'viewport',
      ready: () => expect(extracted).toHaveAttribute('aria-pressed', 'true')
    });
  }
);
