import { Appearance } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const content = '# Field observations\n\nThree **trees** were measured at the river bank.';

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

    const [note] = await Promise.all(
      ['First field notebook', 'Second field notebook'].map((text) =>
        rpc.runPromise(
          rpc.client['notes.createUntitledNote']({
            project: project.id,
            initialMessage: { text, sourceIds: [attachment.id] }
          })
        )
      )
    );

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

    await expect(standalone).toHaveAttribute('aria-description', copy.UploadedMaterialsReady);
    expect((await rpc.runPromise(rpc.client['notes.notes']({ limit: 10 }))).items).toHaveLength(2);
    const sidebar = page.getByRole('navigation', { name: copy.UploadedMaterials });
    const search = page.getByRole('searchbox', { name: copy.UploadedMaterialsSearch });

    await search.fill('STANDALONE');
    await expect(sidebar.getByRole('link', { name: /river-notebook/ })).toHaveCount(0);
    await expect(standalone).toBeVisible();
    await standalone.focus();
    await standalone.press('Enter');
    await expect(page.getByRole('heading', { name: 'Field observations' })).toBeVisible();
    const download = page.waitForEvent('download');

    await page.getByRole('button', { name: copy.ReaderOriginal }).click();
    expect((await download).suggestedFilename()).toBe('standalone.md');

    await expect(standalone).toHaveAttribute('aria-current', 'page');
    await expect(search).toHaveValue('STANDALONE');
    await page.getByRole('button', { name: copy.UploadedMaterialsDetails }).click();
    await expect(page.getByText(copy.UploadedMaterialsFileName, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Field observations' })).toBeVisible();
    await expect(standalone).toHaveAttribute('aria-current', 'page');
    await expectScreenshot('subject-files', {
      target: 'viewport',
      ready: async () => {
        await expect(standalone).toHaveAttribute('aria-description', copy.UploadedMaterialsReady);
        await expect(page.getByRole('link', { name: /river-notebook\.md/ })).toHaveAttribute(
          'aria-description',
          copy.UploadedMaterialsReady
        );
      }
    });
    await sidebar.getByRole('link', { name: /river-notebook/ }).click();
    await expect(page.getByRole('heading', { name: attachment.name, exact: true })).toBeVisible();
    await expect(standalone).toBeVisible();
    await expect(sidebar.getByText(attachment.name, { exact: true })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Field observations' })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await page.getByRole('button', { name: copy.UploadedMaterialsBack }).click();
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole('link', { name: /river-notebook/ }).click();
    await expect(page.getByRole('heading', { name: attachment.name, exact: true })).toBeVisible();

    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto(`/projects/${project.id}/notes/${note!.id}`);
    await page
      .getByRole('region', { name: copy.NoteNotebook })
      .getByRole('button', { name: attachment.name, exact: true })
      .click();
    const noteReader = page.getByRole('tabpanel');

    await expect(noteReader.getByRole('heading', { name: 'Field observations' })).toBeVisible();
    await expect(noteReader.locator('strong')).toHaveText('trees');
    await noteReader
      .getByRole('button', { name: copy.UploadedMaterialsOriginal, exact: true })
      .click();
    await expect(noteReader.getByText('# Field observations', { exact: false })).toBeVisible();
    await noteReader.getByRole('button', { name: copy.UploadedMaterialsText }).click();
    await expect(noteReader.getByRole('heading', { name: 'Field observations' })).toBeVisible();
  }
);

test.browser.stable(
  'Edit a Markdown material without leaving its reader',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const subject = await rpc.runPromise(rpc.client['projects.createProject']({ name: 'Editing' }));
    const original = '# First draft\r\n\r\nWritten during class.';
    const bytes = new TextEncoder().encode(original);
    const file = await rpc.runPromise(
      rpc.client['sources.createSource']({
        projectId: subject.id,
        name: 'lecture.md',
        bytes
      })
    );

    await page.goto(`/projects/${subject.id}/sources/${file.id}?fromUploads=1`);
    await page.getByRole('button', { name: 'Edit file', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'File contents' });

    await expectScreenshot('inline-markdown-editor', {
      target: 'viewport',
      ready: async () => {
        await expect(input).toHaveValue(original.replaceAll('\r\n', '\n'));
      }
    });
    await input.fill('# Second draft\n\nReady to study.');
    await page.getByRole('button', { name: 'Save revision' }).click();
    await expect(input).toHaveCount(0);
    const download = page.waitForEvent('download');

    await page.getByRole('button', { name: copy.ReaderOriginal, exact: true }).click();
    expect(await Bun.file(await (await download).path()).text()).toBe(
      '# Second draft\r\n\r\nReady to study.'
    );
    await expect(page.getByRole('heading', { name: 'Second draft' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Second draft' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit file', exact: true }).click();
    await input.fill('discarded');
    await page.getByRole('button', { name: copy.Cancel, exact: true }).click();
    const current = await rpc.runPromise(rpc.client['sources.sourceExport']({ id: file.id }));

    expect(new TextDecoder().decode(current.bytes)).toBe('# Second draft\r\n\r\nReady to study.');
    const previous = await rpc.runPromise(
      rpc.client['sources.exportRevision']({ sourceId: file.id, revision: 1n })
    );

    expect(previous.bytes).toEqual(bytes);
  }
);

test.browser.stable(
  'Preview slides and other files in Materials',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Lectures' })
    );
    const fixtures = new URL(
      '../../../server/src/features/sources/decoders/fixtures/',
      import.meta.url
    );
    const deck = await Bun.file(new URL('sample.pptx', fixtures)).bytes();
    const document = await Bun.file(new URL('sample.docx', fixtures)).bytes();
    const files = [
      { name: 'reading.docx', bytes: document },
      { name: 'counts.csv', bytes: new TextEncoder().encode('Item,Count\nCells,24') },
      { name: 'archive.bin', bytes: new Uint8Array([0, 255, 0, 255]) }
    ];
    const presentation = await rpc.runPromise(
      rpc.client['sources.createSource']({
        projectId: project.id,
        name: 'lecture.pptx',
        bytes: deck
      })
    );

    for (const { name, bytes } of files)
      await rpc.runPromise(
        rpc.client['sources.createSource']({ projectId: project.id, name, bytes })
      );

    const presentationRoute = `/projects/${project.id}/sources/${presentation.id}?fromUploads=1`;

    await page.goto(presentationRoute);
    const preview = page.getByRole('region', { name: copy.MaterialPreview });
    const next = preview.getByRole('button', { name: copy.MaterialNextSlide });
    const previous = preview.getByRole('button', { name: copy.MaterialPreviousSlide });
    const materials = page.getByRole('navigation', { name: copy.UploadedMaterials });

    await expect(preview.getByText(copy.MaterialPreviewSimplified)).toBeVisible();
    await expect(preview.getByText('Slide 2', { exact: true })).toBeVisible();
    await expect(preview.getByText('Slide 1', { exact: true })).toHaveCount(0);
    await expect(previous).toBeDisabled();
    await next.press('Enter');
    await expect(next).toBeDisabled();
    await expect(preview.getByText('Slide 1', { exact: true })).toBeVisible();
    await expectScreenshot('slide-preview', {
      target: 'viewport',
      ready: async () => {
        await expect(preview.getByText('Slide 2 of 2', { exact: true })).toBeVisible();

        for (const name of ['lecture.pptx', 'counts.csv', 'reading.docx'])
          await expect(materials.getByRole('link', { name, exact: true })).toHaveAttribute(
            'aria-description',
            copy.UploadedMaterialsReady
          );

        await expect(materials.getByRole('link', { name: /archive\.bin/ })).toContainText(
          copy.MaterialOriginalOnly
        );
      }
    });
    await previous.press('Space');
    await expect(preview.getByText('Slide 2', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: copy.UploadedMaterialsText, exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect(page.getByText('Slide 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Slide 2', { exact: true })).toBeVisible();

    await materials.getByRole('link', { name: /reading\.docx/ }).click();
    await expect(preview.getByRole('heading', { name: 'Heading', exact: true })).toBeVisible();
    await expect(next).toHaveCount(0);
    await materials.getByRole('link', { name: /counts\.csv/ }).click();
    await expect(preview.getByText('Cells,24', { exact: false })).toBeVisible();
    await materials.getByRole('link', { name: /archive\.bin/ }).click();
    await expect(preview.getByText(copy.UploadedMaterialsPreviewUnavailable)).toBeVisible();
    await expect(
      page.getByRole('button', { name: copy.ReaderOriginal, exact: true })
    ).toBeEnabled();

    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(
      rpc.client['settings.saveAppSettings']({ ...settings, appearance: Appearance.LIGHT })
    );
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(presentationRoute);
    await expectScreenshot('slide-preview-phone-light', {
      target: 'viewport',
      ready: async () => {
        await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
        await expect(preview.getByText('Slide 1 of 2', { exact: true })).toBeVisible();
        await expect(preview.getByText('Slide 2', { exact: true })).toBeInViewport();
      }
    });
  }
);
