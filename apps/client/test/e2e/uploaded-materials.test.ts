import { Appearance, Language } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const content = '# Field observations\n\nThree **trees** were measured at the river bank.';

const readyTextMetadata = new RegExp(
  `^${copy['sourceKind.text']} · ${copy.UploadedMaterialsReady} · `
);

test.browser.stable(
  'Open original materials from their subject',
  async ({ page, rpc, expect, expectScreenshot }) => {
    await page.goto('/uploads');
    await expect(page.getByText(copy.UploadedMaterialsEmptyGlobal)).toBeVisible();

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

    await expect(standalone).toHaveAccessibleDescription(readyTextMetadata);
    await expect(standalone.getByText(copy['sourceKind.text'], { exact: true })).toBeVisible();
    await expect(standalone.getByText(copy.UploadedMaterialsReady, { exact: true })).toBeVisible();
    await expect(standalone.locator('time')).toBeVisible();
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
    await expect(page.getByRole('heading', { name: copy.MaterialFileInformation })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Field observations' })).toBeVisible();
    await expect(standalone).toHaveAttribute('aria-current', 'page');
    await expectScreenshot('subject-files', {
      target: 'viewport',
      ready: async () => {
        await expect(standalone).toHaveAccessibleDescription(readyTextMetadata);
        await expect(
          page.getByRole('link', { name: /river-notebook\.md/ })
        ).toHaveAccessibleDescription(readyTextMetadata);
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
    await expect(
      standalone.getByText(copy.UploadedMaterialsReady, { exact: true })
    ).toBeInViewport();
    await sidebar.getByRole('link', { name: /river-notebook/ }).click();
    await expect(page.getByRole('heading', { name: attachment.name, exact: true })).toBeVisible();

    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(
      rpc.client['settings.saveAppSettings']({ ...settings, language: Language.ITALIAN })
    );
    await page.goto(`/projects/${project.id}/uploads`);
    const italian = catalogs.italian;
    const italianSidebar = page.getByRole('navigation', { name: italian.UploadedMaterials });
    const italianRow = italianSidebar.getByRole('link', { name: 'standalone.md', exact: true });

    await expectScreenshot('subject-files-phone-italian', {
      target: 'viewport',
      ready: async () => {
        await expect(
          italianRow.getByText(italian['sourceKind.text'], { exact: true })
        ).toBeInViewport();
        await expect(
          italianRow.getByText(italian.UploadedMaterialsReady, { exact: true })
        ).toBeInViewport();
        await expect(italianRow.locator('time')).toBeInViewport();
      }
    });
    await rpc.runPromise(rpc.client['settings.saveAppSettings'](settings));
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto(`/projects/${project.id}/notes/${note!.id}`);
    const noteContext = page.getByRole('complementary', { name: copy.NoteContextPanel });

    await expect(noteContext).toBeVisible();
    await expect(noteContext.getByText(attachment.name, { exact: true })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await noteContext.getByRole('button', { name: copy.NoteHistory, exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: copy.NoteNotebook })
        .getByText('First field notebook', { exact: true })
    ).toBeVisible();
    await expect(page.getByText(attachment.name, { exact: true })).toHaveCount(0);

    await materials.click();
    const historicalFile = sidebar.getByRole('link', { name: attachment.name, exact: true });

    await expect(historicalFile).toHaveAccessibleDescription(readyTextMetadata);
    await historicalFile.click();
    await expect(page.getByRole('heading', { name: 'Field observations' })).toBeVisible();
    await expect(page.locator('[data-materials-reader] strong')).toHaveText('trees');

    const unassigned = await rpc.runPromise(
      rpc.client['sources.createSource']({
        name: 'unassigned.md',
        bytes: new TextEncoder().encode(content),
        projectId: null
      })
    );

    await page.goto('/notes');
    await materials.click();
    await expect(page).toHaveURL(/\/uploads$/);
    await expect(page.getByRole('button', { name: copy.UploadedMaterialsAdd })).toHaveCount(0);
    const looseFile = sidebar.getByRole('link', { name: unassigned.name, exact: true });

    await looseFile.click();
    await expect(page).toHaveURL(/\/sources\/\d+\?fromUploads=1$/);
    await expect(looseFile).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Field observations' })).toBeVisible();

    await page.getByRole('combobox', { name: copy.UploadedMaterialsAll }).click();
    await page.getByRole('option', { name: project.name, exact: true }).click();
    await expect(looseFile).toHaveCount(0);
    await page.getByRole('combobox', { name: project.name }).click();
    await page.getByRole('link', { name: copy.UploadedMaterialsAll, exact: true }).click();
    await expect(page).toHaveURL(/\/uploads$/);
    await expect(looseFile).toBeVisible();
  }
);

test.browser.stable(
  'Render original GitHub Flavored Markdown in Materials',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const subject = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Markdown' })
    );
    const original = [
      '# Field notebook',
      '',
      'Written during **class** and *review*. [Reference](https://example.com/study)',
      '',
      '1. Inspect the slide',
      '2. Record the result',
      '',
      '- [x] Recorded',
      '- [ ] Reviewed',
      '',
      '> Keep the field notes.',
      '',
      '```ts',
      'const stages = 4;',
      '```',
      '',
      '| Stage | Count |',
      '| ----- | ----: |',
      '| Mitosis | 4 |',
      '',
      '[Unsafe destination](javascript:alert%281%29)',
      '',
      '![Remote sample](https://example.com/sample.svg)',
      '',
      '<img src="https://example.com/raw.svg" alt="Raw sample">'
    ].join('\r\n');
    const bytes = new TextEncoder().encode(original);
    const file = await rpc.runPromise(
      rpc.client['sources.createSource']({
        projectId: subject.id,
        name: 'lecture.md',
        bytes
      })
    );

    await page.goto(`/projects/${subject.id}/sources/${file.id}?fromUploads=1`);
    const reader = page.locator('[data-materials-reader]');

    await expect(reader.getByRole('button', { name: copy.MaterialPreview })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(reader.getByRole('heading', { name: 'Field notebook', level: 1 })).toBeVisible();
    await expect(reader.getByRole('table').getByRole('cell', { name: 'Mitosis' })).toBeVisible();
    await expect(reader.getByText('Inspect the slide', { exact: true })).toBeVisible();
    await expect(reader.getByRole('checkbox').first()).toBeChecked();
    await expect(reader.getByRole('checkbox').last()).toBeDisabled();
    await expect(reader.locator('blockquote')).toHaveText('Keep the field notes.');
    await expect(reader.locator('strong')).toHaveText('class');
    await expect(reader.locator('em')).toHaveText('review');
    await expect(reader.locator('pre code')).toHaveText('const stages = 4;');
    const reference = reader.getByRole('link', { name: 'Reference' });
    const code = reader.locator('pre');

    await expect(reference).toHaveAttribute('href', 'https://example.com/study');
    await expect(reference).toHaveAttribute('rel', 'noopener noreferrer');
    await reference.focus();
    await reference.press('Tab');
    await expect(code).toBeFocused();
    await code.press('Tab');
    await expect(reader.locator('.source-markdown-table')).toBeFocused();
    await expect(reader.getByText('Unsafe destination')).toBeVisible();
    await expect(reader.getByRole('link', { name: 'Unsafe destination' })).toHaveCount(0);
    await expect(reader.getByText('Remote sample')).toBeVisible();
    await expect(reader.getByRole('img')).toHaveCount(0);
    const extracted = reader.getByRole('button', { name: copy.UploadedMaterialsText });

    await extracted.press('Enter');
    await expect(extracted).toHaveAttribute('aria-pressed', 'true');
    await reader.getByRole('button', { name: copy.MaterialPreview }).press('Enter');

    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    await rpc.runPromise(
      rpc.client['settings.saveAppSettings']({ ...settings, appearance: Appearance.LIGHT })
    );
    await page.setViewportSize({ width: 390, height: 780 });
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await expect(reader.getByRole('heading', { name: 'Field notebook', level: 1 })).toBeVisible();
    const table = reader.getByRole('table');

    await table.scrollIntoViewIfNeeded();
    await expectScreenshot('markdown-phone-light', {
      target: 'viewport',
      ready: async () => {
        await expect(table).toBeInViewport({ ratio: 0.99 });
        await expect(reader.getByRole('checkbox').first()).toBeChecked();
      }
    });
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
  'Read extracted PowerPoint slides in Materials',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Lectures' })
    );
    const dataFixtures = new URL(
      '../../../../tooling/scripts/seed/fixtures/files/mitosis/',
      import.meta.url
    );
    const deck = await Bun.file(new URL('phases.pptx', dataFixtures)).bytes();
    const presentation = await rpc.runPromise(
      rpc.client['sources.createSource']({
        projectId: project.id,
        name: 'lecture.pptx',
        bytes: deck
      })
    );

    const presentationRoute = `/projects/${project.id}/sources/${presentation.id}?fromUploads=1`;

    const metaphase = page.getByText('I cromosomi si allineano al centro della cellula.', {
      exact: true
    });
    const anaphase = page.getByText('I cromatidi fratelli si separano.', { exact: true });
    const original = page.getByRole('button', { name: copy.ReaderOriginal, exact: true });
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));

    const openSlides = async (appearance: Appearance) => {
      await rpc.runPromise(rpc.client['settings.saveAppSettings']({ ...settings, appearance }));
      await page.goto(presentationRoute);
      await expect(
        page.getByRole('button', { name: copy.MaterialPreview, exact: true })
      ).toHaveCount(0);
      await expect(original).toBeInViewport();
    };
    const expectOriginalDownload = async () => {
      const readerUrl = page.url();
      const pending = page.waitForEvent('download');

      await original.press('Enter');
      const saved = await pending;

      expect(saved.suggestedFilename()).toBe('lecture.pptx');
      expect(await Bun.file(await saved.path()).bytes()).toEqual(deck);
      await expect(page).toHaveURL(readerUrl);
      await expect(metaphase).toBeVisible();
      await expect(anaphase).toBeVisible();
    };

    await openSlides(Appearance.DARK);
    await expectScreenshot('extracted-slides-desktop-dark', {
      target: 'viewport',
      ready: async () => {
        await expect(page.locator('html')).toHaveClass(/\bdark\b/);
        await expect(metaphase).toBeInViewport();
        await expect(anaphase).toBeInViewport();
      }
    });
    await expectOriginalDownload();

    await page.setViewportSize({ width: 390, height: 780 });
    await openSlides(Appearance.LIGHT);
    await expectScreenshot('extracted-slides-phone-light', {
      target: 'viewport',
      ready: async () => {
        await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
        await expect(metaphase).toBeInViewport();
        await expect(anaphase).toBeInViewport();
      }
    });
    await expectOriginalDownload();
  }
);

test.browser.stable(
  'Preview documents, tables, and original-only files in Materials',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Lectures' })
    );
    const dataFixtures = new URL(
      '../../../../tooling/scripts/seed/fixtures/files/mitosis/',
      import.meta.url
    );
    const word = {
      name: 'reading.docx',
      bytes: await Bun.file(new URL('laboratory.docx', dataFixtures)).bytes()
    };
    const files = [
      word,
      {
        name: 'counts.csv',
        bytes: new TextEncoder().encode('Roma,0012,TRUE\n"Cells, sampled",24,"Two\nlines"')
      },
      { name: 'files.zip', bytes: await Bun.file(new URL('laboratory.zip', dataFixtures)).bytes() },
      { name: 'archive.bin', bytes: new Uint8Array([0, 255, 0, 255]) }
    ];

    for (const { name, bytes } of files)
      await rpc.runPromise(
        rpc.client['sources.createSource']({ projectId: project.id, name, bytes })
      );

    await page.goto(`/projects/${project.id}/uploads`);
    const preview = page.getByRole('region', { name: copy.MaterialPreview });
    const materials = page.getByRole('navigation', { name: copy.UploadedMaterials });

    await materials.getByRole('link', { name: /reading\.docx/ }).click();
    await expect(
      page.getByRole('button', { name: copy.UploadedMaterialsText, exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('heading', { name: 'Domanda di laboratorio', exact: true, level: 2 })
    ).toBeVisible();
    await expect(
      page.getByText('Quale indizio distingue la metafase dalla anafase?', { exact: true })
    ).toBeVisible();
    const table = page.getByRole('table');
    const row = table.getByRole('row').filter({ hasText: 'Metafase' });

    await expect(table.getByText('Cellule osservate', { exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: '12', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: copy.MaterialPreview, exact: true })).toHaveCount(
      0
    );
    await expect(preview).toHaveCount(0);
    const wordRoute = page.url();
    const wordDownload = page.waitForEvent('download');

    await page.getByRole('button', { name: copy.ReaderOriginal, exact: true }).press('Enter');
    const savedWord = await wordDownload;

    expect(savedWord.suggestedFilename()).toBe(word.name);
    expect(await Bun.file(await savedWord.path()).bytes()).toEqual(word.bytes);
    await expect(page).toHaveURL(wordRoute);
    await materials.getByRole('link', { name: /counts\.csv/ }).click();
    const grid = preview.getByRole('grid');

    await expect(grid.getByRole('columnheader', { name: 'A', exact: true })).toBeVisible();

    const first = grid.getByRole('gridcell', { name: 'Roma', exact: true });

    await first.click();
    await first.press('ArrowRight');
    await expect(grid.getByRole('gridcell', { name: '0012', exact: true })).toBeFocused();
    await expect(grid.getByRole('gridcell', { name: 'TRUE', exact: true })).toBeVisible();
    await expect(grid.getByRole('gridcell', { name: 'Cells, sampled', exact: true })).toBeVisible();
    await expect(grid.getByRole('gridcell', { name: 'Two lines', exact: true })).toHaveText(
      'Two\nlines',
      { useInnerText: true }
    );
    await expectScreenshot('csv-preview', {
      target: 'viewport',
      ready: () => expect(grid.getByRole('gridcell', { name: '0012', exact: true })).toBeFocused()
    });

    for (const original of files.filter(
      ({ name }) => name === 'files.zip' || name === 'archive.bin'
    )) {
      const item = materials.getByRole('link', { name: original.name, exact: true });

      await expect(item.getByText(copy.MaterialOriginalOnly, { exact: true })).toBeVisible();
      await item.click();
      const details = page.getByRole('region', { name: copy.MaterialFileInformation });
      const download = page.getByRole('button', { name: copy.ReaderOriginal, exact: true });

      await expect(details).toBeVisible();
      await expect(download).toHaveCount(1);

      await expect(download).toBeInViewport();
      await expect(
        page.getByRole('button', { name: copy.MaterialPreview, exact: true })
      ).toHaveCount(0);
      const pending = page.waitForEvent('download');

      await download.press('Enter');
      const saved = await pending;

      expect(saved.suggestedFilename()).toBe(original.name);
      expect(await Bun.file(await saved.path()).bytes()).toEqual(original.bytes);
    }
  }
);
