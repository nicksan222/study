import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const files = [
  {
    name: 'river-survey.md',
    title: 'River survey source',
    first: 'River sentinel: the first survey measured twelve willow trees.',
    last: 'River conclusion: retain the original bank measurements.'
  },
  {
    name: 'orchard-inventory.md',
    title: 'Orchard inventory source',
    first: 'Orchard sentinel: seven pear trees need a second inspection.',
    last: 'Orchard conclusion: count the eastern row again in spring.'
  },
  {
    name: 'coastal-fieldbook.md',
    title: 'Coastal fieldbook source',
    first: 'Coastal beginning sentinel: the lighthouse marks the first observation.',
    last: 'Coastal final sentinel: the final tide reading completes this fieldbook.'
  }
];

const middle = 'Coastal middle sentinel: compare the sheltered cove with the exposed beach.';

const observations = Array.from(
  { length: 30 },
  (_, index) =>
    `## Coastal station ${index + 1}\n\n` +
    `Station ${index + 1} records the water level beside the coastal path. The survey team checks the same marked post before collecting sand samples. Keep these measurements with the original fieldbook so another team can repeat the route and compare the shoreline after the next storm.\n\n` +
    (index === 14 ? `${middle}\n\n` : '') +
    '- Record the time and water level.\n- Preserve the location of the marked post.'
);

test.browser.stable(
  'Reopen original Markdown files and their history in Materials',
  async ({ page, expectScreenshot, expect, rpc }) => {
    const project = await rpc.runPromise(
      rpc.client['projects.createProject']({ name: 'Fieldwork' })
    );
    const uploads = `/projects/${project.id}/uploads`;
    const panel = page.locator('[data-materials-reader]');
    const preview = panel.getByRole('article');
    const library = page.getByRole('navigation', { name: copy.UploadedMaterials });

    for (const [index, file] of files.entries()) {
      const markdown = [
        `# ${file.title}`,
        file.first,
        ...(index === 2
          ? observations
          : ['- Measure the marked row.\n- Keep the original record.']),
        '```text\nsurvey_completed = true\n```',
        file.last
      ].join('\n\n');

      await rpc.runPromise(
        rpc.client['sources.createSource']({
          name: file.name,
          bytes: new TextEncoder().encode(markdown),
          projectId: project.id
        })
      );
    }

    await page.goto(uploads);
    await expect(library.getByRole('link')).toHaveCount(files.length);

    for (const file of files) {
      const row = library.getByRole('link', { name: file.name, exact: true });

      await row.press('Enter');
      await expect(row).toHaveAttribute('aria-current', 'page');
      await expect(preview.getByRole('heading', { name: file.title, exact: true })).toBeVisible();
      await expect(preview.getByText(file.first, { exact: true })).toBeVisible();
      await expect(preview.getByText(file.last, { exact: true })).toBeVisible();
      await expect(preview.locator('[contenteditable="true"]')).toHaveCount(0);
      await expect(
        panel.getByRole('button', { name: copy.ReaderOriginal, exact: true })
      ).toBeEnabled();
      await expect(
        panel.getByRole('button', { name: copy.MaterialCopyToPages, exact: true })
      ).toBeEnabled();

      for (const other of files.filter((entry) => entry !== file))
        await expect(preview.getByText(other.first, { exact: true })).toHaveCount(0);
    }

    const center = preview.getByText(middle, { exact: true });
    const end = preview.getByText(files.at(-1)!.last, { exact: true });

    await center.scrollIntoViewIfNeeded();
    await expectScreenshot('long-source-middle', {
      target: 'viewport',
      ready: () => expect(center).toBeInViewport({ ratio: 1 })
    });
    await end.scrollIntoViewIfNeeded();
    await expectScreenshot('long-source-bottom', {
      target: 'viewport',
      ready: async () => {
        await expect(end).toBeInViewport({ ratio: 1 });
        await expect(preview.locator('pre')).toContainText('survey_completed = true');
      }
    });

    const oldest = files[0]!;

    await library.getByRole('link', { name: oldest.name, exact: true }).click();
    await page.reload();
    await expect(preview.getByText(oldest.first, { exact: true })).toBeVisible();
    const history = panel.getByRole('button', { name: copy.ReaderHistory, exact: true });

    await history.press('Enter');
    const versions = page.getByRole('dialog', { name: copy.ReaderHistory, exact: true });
    const version = versions.getByRole('button', { name: new RegExp(`^${copy.ReaderVersion} 1`) });

    await expectScreenshot('source-history', {
      target: 'viewport',
      ready: () => expect(version).toBeVisible()
    });
    await version.click();
    await expect(versions).toBeHidden();
    await expect(history).toBeFocused();
    await expect(panel.getByText(oldest.first, { exact: true })).toBeVisible();

    const notes = panel.getByRole('button', { name: copy.ReaderExtractionNotes, exact: true });

    await notes.press('Enter');
    const details = page.getByRole('dialog', { name: copy.ReaderExtractionNotes, exact: true });

    await expect(details.getByText(copy.ReaderOmitMarkup, { exact: true })).toBeVisible();
    await details.getByRole('button', { name: copy.Close, exact: true }).click();
    await expect(notes).toBeFocused();
    await history.press('Enter');
    await expect(version).toHaveAttribute('aria-current', 'true');
    await versions.getByRole('button', { name: copy.ReaderCurrent, exact: true }).click();
    await expect(history).toBeFocused();

    const actions = panel.getByRole('button', { name: copy.MediaActions, exact: true });

    for (const name of [copy.SourceHistoryPrune, copy.SourceDeleteTitle]) {
      await actions.press('Enter');
      await page.getByRole('menuitem', { name, exact: true }).press('Enter');
      const dialog = page.getByRole('alertdialog', { name, exact: true });

      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: copy.Cancel, exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(actions).toBeFocused();
      await expect(preview.getByText(oldest.first, { exact: true })).toBeVisible();
    }
  }
);
