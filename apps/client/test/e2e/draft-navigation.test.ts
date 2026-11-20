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

test.browser.stable(
  'Scoped drafts survive navigation and save to their own projects',
  async ({ page, expectScreenshot, expect }) => {
    await page.goto('/notes');
    const composer = page.getByRole('textbox', { name: copy.NoteCompose });
    const composeRegion = page.getByRole('region', { name: copy.NoteCompose, exact: true });
    const save = page.getByRole('button', { name: copy.NoteSaveNote, exact: true });
    const picker = page.locator('[data-slot="combobox-trigger"]');
    const navigation = page.getByRole('navigation', { name: copy.SidebarNavigation });
    const saved = new Map<string, string>();
    const projects = new Map<string, string>();

    async function controls({ expect }: Pick<test.browser.Context, 'expect'>) {
      for (const control of [composer, save]) {
        await expect(control).toBeInViewport({ ratio: 1 });

        if (await control.isEnabled()) await control.click({ trial: true });
      }
    }

    async function assertDraft(
      { expect }: Pick<test.browser.Context, 'expect'>,
      scope: (typeof scopes)[number]
    ) {
      await expect(page).toHaveURL(`${projects.get(scope.name)}/notes`);
      await expect(picker).toHaveAccessibleName(scope.name);
      await expect(picker).toContainText(scope.name);
      await expect(composer).toHaveValue(scope.text);
      await expect(page.locator('a[href*="/notes/"]')).toHaveCount(saved.has(scope.name) ? 1 : 0);
      await expect(save).toBeEnabled();
      await controls({ expect });
    }

    async function selectScope(
      { expect }: Pick<test.browser.Context, 'expect'>,
      scope: (typeof scopes)[number]
    ) {
      await picker.click();
      await page.getByRole('option', { name: scope.name, exact: true }).click();
      await expect(picker).toHaveAccessibleName(scope.name);
      await expect(picker).toContainText(scope.name);
      await navigation.getByRole('link', { name: copy.Notes }).click();
      await page.getByRole('link', { name: scope.title }).click();
    }

    async function visitOtherRoutes({ expect }: Pick<test.browser.Context, 'expect'>) {
      await navigation.getByRole('link', { name: copy.Practice }).click();
      await expect(page).toHaveURL(/\/practice$/);
      await page.getByRole('button', { name: copy.Settings, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: copy.Settings });

      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: copy.Close, exact: true }).click();
      await expect(dialog).toBeHidden();
      await picker.click();
      await page.getByRole('link', { name: copy.Projects, exact: true }).click();
      await expect(page).toHaveURL(/\/projects$/);
    }

    async function createDraft(
      { expect }: Pick<test.browser.Context, 'expect'>,
      scope: (typeof scopes)[number],
      index: number
    ) {
      await picker.click();
      await page
        .locator('[data-slot="combobox-popup"]')
        .getByRole('button', { name: copy.NewProject, exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: copy.NewProject, exact: true });

      await dialog.getByRole('textbox', { name: copy.ProjectName, exact: true }).fill(scope.name);
      await dialog.getByRole('button', { name: copy.CreateProject, exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(picker).toHaveAccessibleName(scope.name);
      await expect(picker).toContainText(scope.name);
      await navigation.getByRole('link', { name: copy.Notes }).click();
      await expect(page).toHaveURL(/\/projects\/[^/]+\/notes$/);
      projects.set(scope.name, page.url().replace(/\/notes$/, ''));
      await expect(composer).toHaveValue('');
      await expect(composeRegion.locator('li')).toHaveCount(0);
      await composer.fill(scope.text);
      await assertDraft({ expect }, scope);

      if (index === 0) {
        await composer.press('ControlOrMeta+Home');
        await composer.press('PageUp');
        await expect(composer).toHaveJSProperty('scrollTop', 0);
        await expectScreenshot('draft-with-files', {
          target: 'viewport',
          ready: async () => {
            await expect(composer).toHaveValue(scope.text);
            await controls({ expect });
          }
        });
        await expect(composer).toHaveJSProperty('scrollTop', 0);

        for (let paragraph = 0; paragraph < 26; paragraph++)
          await composer.press('Control+ArrowDown');

        await expectScreenshot('draft-middle', {
          target: 'viewport',
          ready: async () => {
            await expect(composer).toHaveValue(scope.text);
            await controls({ expect });
          }
        });
        await expect(composer).not.toHaveJSProperty('scrollTop', 0);
        await composer.press('ControlOrMeta+End');
        await expectScreenshot('draft-bottom', {
          target: 'viewport',
          ready: async () => {
            await expect(composer).toHaveValue(scope.text);
            await controls({ expect });
          }
        });
        await expect(composer).not.toHaveJSProperty('scrollTop', 0);
        await expect(composer).toHaveValue(scope.text);
      }
    }

    for (const [index, scope] of scopes.entries()) await createDraft({ expect }, scope, index);

    const a = scopes[0]!;
    const b = scopes[1]!;

    for (let round = 0; round < 2; round++) {
      for (const scope of scopes) {
        await visitOtherRoutes({ expect });
        await selectScope({ expect }, scope);
        await assertDraft({ expect }, scope);
      }
    }

    await selectScope({ expect }, a);
    await composer.press('ControlOrMeta+Home');
    await expectScreenshot('returned-draft', {
      target: 'viewport',
      ready: async () => {
        await expect(composer).toHaveValue(a.text);
        await assertDraft({ expect }, a);
      }
    });

    async function assertSaved(
      { expect }: Pick<test.browser.Context, 'expect'>,
      scope: (typeof scopes)[number]
    ) {
      await expect(picker).toHaveAccessibleName(scope.name);
      await expect(picker).toContainText(scope.name);
      await expect(composer).toBeHidden();
      await expect(
        page.getByRole('button', { name: copy.NoteAddCapture, exact: true })
      ).toHaveAttribute('aria-expanded', 'false');
      const notebook = page.getByRole('region', { name: copy.NoteNotebook });
      const entry = notebook.locator('[data-role="user"]');

      await expect(entry).toHaveCount(1);
      await expect(entry.locator('[data-slot="chat-message-text"]')).toHaveText(scope.text);

      return { notebook, entry };
    }

    async function saveDraft(
      { expect }: Pick<test.browser.Context, 'expect'>,
      scope: (typeof scopes)[number]
    ) {
      if (scope === b) {
        await selectScope({ expect }, b);
        await assertDraft({ expect }, b);
      }

      await save.click();
      await expect(page).toHaveURL(new RegExp(`${projects.get(scope.name)}/notes/[^/?]+$`));
      expect([...saved.values()]).not.toContain(page.url());
      saved.set(scope.name, page.url());
      const { notebook } = await assertSaved({ expect }, scope);

      const body = notebook.locator('[data-slot="chat-message-text"]');
      const heading = body;

      await page
        .getByRole('navigation', { name: copy.NoteOutline })
        .getByRole('button')
        .first()
        .click();
      await expect(heading).toHaveVisibleText(scope.title);
      await expectScreenshot(`${scope === a ? 'river' : 'orchard'}-saved-top`, {
        target: 'viewport',
        ready: async () => {
          await expect(body).toHaveText(scope.text);
          await expect(heading).toHaveVisibleText(scope.title);
        }
      });
      const initial = await body.boundingBox();

      if (!initial) throw new Error('Saved note has no layout box');

      const scroll = page.locator('[data-notebook-scroll-host]');

      await scroll.click();
      await scroll.press('Home');
      await scroll.press('PageDown');
      await expect.poll(async () => (await body.boundingBox())?.y).toBeLessThan(initial.y);
      await expectScreenshot(`${scope === a ? 'river' : 'orchard'}-saved-middle`, {
        target: 'viewport',
        ready: () => expect(body).toHaveText(scope.text)
      });
      await scroll.press('End');
      await expect(heading).not.toHaveVisibleText(scope.title);
      await expect
        .poll(async () => {
          const content = await body.boundingBox();
          const capture = await page.locator('.workspace-desk-capture').boundingBox();

          return !!content && !!capture && content.y + content.height <= capture.y;
        })
        .toBe(true);
      await expect(
        page.getByRole('button', { name: copy.NoteAddCapture, exact: true })
      ).toBeInViewport({ ratio: 1 });
      await expectScreenshot(`${scope === a ? 'river' : 'orchard'}-saved-destination`, {
        target: 'viewport',
        ready: async () => {
          await expect(body).toHaveText(scope.text);
          await assertSaved({ expect }, scope);
        }
      });
    }

    for (const scope of scopes) await saveDraft({ expect }, scope);

    // Only saved work is reloaded: starter drafts intentionally live for one app lifetime.
    for (const scope of scopes) {
      await visitOtherRoutes({ expect });
      await picker.click();
      await page.getByRole('option', { name: scope.name, exact: true }).click();
      await expect(page).toHaveURL(projects.get(scope.name)!);
      await expect(page.getByRole('heading', { name: scope.name, exact: true })).toBeVisible();
      const members = page.getByRole('region', { name: copy.Notes });

      await expect(members.getByRole('link')).toHaveCount(1);
      await expect(members.getByRole('link')).toHaveAttribute(
        'href',
        new URL(saved.get(scope.name)!).pathname
      );
      await members.getByRole('link').click();
      await expect(page).toHaveURL(saved.get(scope.name)!);
      await page.reload();
      await assertSaved({ expect }, scope);
      await expect(page.locator('a[href*="/notes/"]')).toHaveCount(1);
    }
  }
);
