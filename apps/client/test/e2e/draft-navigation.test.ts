import { catalogs } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

const scopes = [
  {
    name: 'River ecology',
    title: 'River draft fieldwork',
    file: 'river-kept.md',
    sentinel: 'River source sentinel: retain the willow measurements.'
  },
  {
    name: 'Orchard ecology',
    title: 'Orchard draft fieldwork',
    file: 'orchard-only.md',
    sentinel: 'Orchard source sentinel: count seven pear trees.'
  }
].map((scope) => ({
  ...scope,
  text: [
    scope.title,
    ...Array.from(
      { length: 24 },
      (_, index) =>
        `${scope.name} observation ${index + 1}. Record the marked trees beside the field path and preserve the original measurements. This account belongs only to ${scope.name}. Check the same station next season so the next team can compare the complete record without losing its context.`
    ),
    `${scope.name} final sentinel: this completes the unsaved fieldwork.`
  ].join('\n\n')
}));

const removed = 'river-removed.md';

test.stable(
  'Scoped drafts survive navigation and save to their own projects',
  async ({ page, expectScreenshot }) => {
    await page.goto('/notes');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const composeRegion = page.getByRole('region', { name: copy.NoteCompose, exact: true });
    const save = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });
    const picker = page.locator('[data-slot="combobox-trigger"]');
    const navigation = page.getByRole('navigation', { name: copy.SidebarNavigation });
    const saved = new Map<string, string>();
    const projects = new Map<string, string>();

    async function controls() {
      for (const control of [
        composer,
        save,
        composeRegion.getByTitle(copy.NoteAttachFiles, { exact: true })
      ]) {
        await test.expect(control).toBeInViewport({ ratio: 1 });

        if (await control.isEnabled()) await control.click({ trial: true });
      }
    }

    async function assertDraft(scope: (typeof scopes)[number], filenames: string[]) {
      await test.expect(page).toHaveURL(`${projects.get(scope.name)}/notes`);
      await test.expect(picker).toHaveAccessibleName(scope.name);
      await test.expect(picker).toContainText(scope.name);
      await test.expect(composer).toHaveValue(scope.text);
      await test
        .expect(composeRegion.locator('li > span').filter({ hasText: /\S/ }))
        .toHaveText(filenames);
      await test
        .expect(composeRegion.getByRole('button', { name: copy.NoteRemoveAttachment, exact: true }))
        .toHaveCount(filenames.length);
      await test
        .expect(page.locator('a[href*="/notes/"]'))
        .toHaveCount(saved.has(scope.name) ? 1 : 0);
      await test.expect(save).toBeEnabled();
      await controls();
    }

    async function selectScope(scope: (typeof scopes)[number]) {
      await picker.click();
      await page.getByRole('option', { name: scope.name, exact: true }).click();
      await test.expect(picker).toHaveAccessibleName(scope.name);
      await test.expect(picker).toContainText(scope.name);
      await navigation.getByRole('link', { name: copy.Notes }).click();
      await page.getByRole('link', { name: scope.title }).click();
    }

    async function visitOtherRoutes() {
      await navigation.getByRole('link', { name: copy.SourcePage }).click();
      await test.expect(page).toHaveURL(/\/pages$/);
      await page.getByRole('button', { name: copy.Settings, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: copy.Settings });

      await test.expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: copy.Close, exact: true }).click();
      await test.expect(dialog).toBeHidden();
      await picker.click();
      await page.getByRole('link', { name: copy.Projects, exact: true }).click();
      await test.expect(page).toHaveURL(/\/projects$/);
    }

    async function createDraft(scope: (typeof scopes)[number], index: number) {
      await picker.click();
      await page
        .locator('[data-slot="combobox-popup"]')
        .getByRole('button', { name: copy.NewProject, exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: copy.NewProject, exact: true });

      await dialog.getByRole('textbox', { name: copy.ProjectName, exact: true }).fill(scope.name);
      await dialog.getByRole('button', { name: copy.CreateProject, exact: true }).click();
      await test.expect(dialog).toBeHidden();
      await test.expect(picker).toHaveAccessibleName(scope.name);
      await test.expect(picker).toContainText(scope.name);
      await navigation.getByRole('link', { name: copy.Notes }).click();
      await test.expect(page).toHaveURL(/\/projects\/[^/]+\/notes$/);
      projects.set(scope.name, page.url().replace(/\/notes$/, ''));
      await test.expect(composer).toHaveValue('');
      await test.expect(composeRegion.locator('li')).toHaveCount(0);
      await composer.fill(scope.text);
      await page.getByLabel(copy.NoteAttachFiles, { exact: true }).setInputFiles([
        {
          name: scope.file,
          mimeType: 'text/markdown',
          buffer: Buffer.from(`# ${scope.name} source\n\n${scope.sentinel}`)
        },
        ...(index === 0
          ? [
              {
                name: removed,
                mimeType: 'text/markdown',
                buffer: Buffer.from(
                  '# Removed river source\n\nRemoved sentinel: never submit this file.'
                )
              }
            ]
          : [])
      ]);
      await assertDraft(scope, index === 0 ? [scope.file, removed] : [scope.file]);

      if (index === 0) {
        await composer.press('ControlOrMeta+Home');
        await composer.press('PageUp');
        await test.expect(composer).toHaveJSProperty('scrollTop', 0);
        await expectScreenshot('draft-with-files', {
          target: 'viewport',
          ready: async () => {
            await test.expect(composer).toHaveValue(scope.text);
            await controls();
          }
        });
        await test.expect(composer).toHaveJSProperty('scrollTop', 0);

        for (let paragraph = 0; paragraph < 26; paragraph++)
          await composer.press('Control+ArrowDown');

        await expectScreenshot('draft-middle', {
          target: 'viewport',
          ready: async () => {
            await test.expect(composer).toHaveValue(scope.text);
            await controls();
          }
        });
        await test.expect(composer).not.toHaveJSProperty('scrollTop', 0);
        await composer.press('ControlOrMeta+End');
        await expectScreenshot('draft-bottom', {
          target: 'viewport',
          ready: async () => {
            await test.expect(composer).toHaveValue(scope.text);
            await controls();
          }
        });
        await test.expect(composer).not.toHaveJSProperty('scrollTop', 0);
        await test.expect(composer).toHaveValue(scope.text);
      }
    }

    for (const [index, scope] of scopes.entries()) await createDraft(scope, index);

    const a = scopes[0]!;
    const b = scopes[1]!;

    for (let round = 0; round < 2; round++) {
      for (const scope of scopes) {
        await visitOtherRoutes();
        await selectScope(scope);
        await assertDraft(scope, scope === a ? [a.file, removed] : [b.file]);
      }
    }

    await selectScope(a);
    await composeRegion
      .locator('li')
      .filter({ hasText: removed })
      .getByRole('button', { name: copy.NoteRemoveAttachment })
      .click();
    await assertDraft(a, [a.file]);
    await selectScope(b);
    await assertDraft(b, [b.file]);
    await selectScope(a);
    await assertDraft(a, [a.file]);
    await composer.press('ControlOrMeta+Home');
    await expectScreenshot('returned-draft', {
      target: 'viewport',
      ready: async () => {
        await test.expect(composer).toHaveValue(a.text);
        await assertDraft(a, [a.file]);
      }
    });

    async function assertSaved(scope: (typeof scopes)[number]) {
      await test.expect(picker).toHaveAccessibleName(scope.name);
      await test.expect(picker).toContainText(scope.name);
      await test.expect(composer).toHaveValue('');
      await test.expect(save).toBeDisabled();
      const notebook = page.getByRole('region', { name: copy.NoteNotebook });
      const entry = notebook.locator('[data-role="user"]');

      await test.expect(entry).toHaveCount(1);
      await test.expect(entry.locator('[data-slot="chat-message-text"]')).toHaveText(scope.text);
      await test
        .expect(entry.getByRole('button', { name: scope.file, exact: true }))
        .toHaveCount(1);

      for (const filename of [
        removed,
        ...scopes.filter((other) => other !== scope).map((other) => other.file)
      ]) {
        await test.expect(page.getByRole('button', { name: filename, exact: true })).toHaveCount(0);
      }

      return { notebook, entry };
    }

    async function source(scope: (typeof scopes)[number]) {
      const { entry } = await assertSaved(scope);
      const attachment = entry.getByRole('button', { name: scope.file, exact: true });

      await attachment.scrollIntoViewIfNeeded();
      await attachment.click();
      const preview = page
        .getByRole('tabpanel')
        .getByRole('document', { name: copy.NotePageEditor });

      await test.expect(preview.getByText(scope.sentinel, { exact: true })).toBeVisible();
      await test.expect(preview).toHaveAttribute('contenteditable', 'false');
      await test
        .expect(page.getByRole('tabpanel').getByText(copy.NotePending, { exact: true }))
        .toHaveCount(0);
      await test
        .expect(preview.getByText('Removed sentinel: never submit this file.', { exact: true }))
        .toHaveCount(0);

      for (const other of scopes.filter((other) => other !== scope))
        await test.expect(preview.getByText(other.sentinel, { exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: copy.NoteClosePage, exact: true }).click();
    }

    async function saveDraft(scope: (typeof scopes)[number]) {
      if (scope === b) {
        await selectScope(b);
        await assertDraft(b, [b.file]);
      }

      await save.click();
      await test.expect(page).toHaveURL(new RegExp(`${projects.get(scope.name)}/notes/[^/?]+$`));
      test.expect([...saved.values()]).not.toContain(page.url());
      saved.set(scope.name, page.url());
      const { notebook } = await assertSaved(scope);

      await source(scope);
      const body = notebook.locator('[data-slot="chat-message-text"]');
      const heading = notebook.getByText(copy.NoteEntryNote, { exact: true });

      await heading.scrollIntoViewIfNeeded();
      await test.expect(heading).toBeInViewport({ ratio: 1 });
      await expectScreenshot(`${scope === a ? 'river' : 'orchard'}-saved-top`, {
        target: 'viewport',
        ready: async () => {
          await test.expect(body).toHaveText(scope.text);
          await test.expect(heading).toBeInViewport({ ratio: 1 });
        }
      });
      const initial = await body.boundingBox();

      if (!initial) throw new Error('Saved note has no layout box');

      const scroll = page.locator('[data-notebook-scroll-host]');

      await scroll.click();
      await scroll.press('Home');
      await scroll.press('PageDown');
      await test.expect.poll(async () => (await body.boundingBox())?.y).toBeLessThan(initial.y);
      await expectScreenshot(`${scope === a ? 'river' : 'orchard'}-saved-middle`, {
        target: 'viewport',
        ready: () => test.expect(body).toHaveText(scope.text)
      });
      await scroll.press('End');
      await test.expect(heading).not.toBeInViewport();
      await test.expect
        .poll(async () => {
          const content = await body.boundingBox();
          const dock = await page.locator('.workspace-desk-floating-composer').boundingBox();

          return !!content && !!dock && content.y + content.height <= dock.y;
        })
        .toBe(true);
      await controls();
      await expectScreenshot(`${scope === a ? 'river' : 'orchard'}-saved-destination`, {
        target: 'viewport',
        ready: async () => {
          await test.expect(body).toHaveText(scope.text);
          await assertSaved(scope);
        }
      });
    }

    for (const scope of scopes) await saveDraft(scope);

    // Only saved work is reloaded: starter drafts intentionally live for one app lifetime.
    for (const scope of scopes) {
      await visitOtherRoutes();
      await picker.click();
      await page.getByRole('option', { name: scope.name, exact: true }).click();
      await test.expect(page).toHaveURL(projects.get(scope.name)!);
      await test.expect(page.getByRole('heading', { name: scope.name, exact: true })).toBeVisible();
      const members = page.getByRole('region', { name: copy.Notes });

      await test.expect(members.getByRole('link')).toHaveCount(1);
      await test
        .expect(members.getByRole('link'))
        .toHaveAttribute('href', new URL(saved.get(scope.name)!).pathname);
      await members.getByRole('link').click();
      await test.expect(page).toHaveURL(saved.get(scope.name)!);
      await page.reload();
      await assertSaved(scope);
      await source(scope);
      await test.expect(page.locator('a[href*="/notes/"]')).toHaveCount(1);
    }
  }
);
