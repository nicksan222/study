import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type { Locator } from 'playwright';

const copy = catalogs.english;

const phone = { width: 390, height: 844 };

test.browser.use({ viewport: phone, isMobile: true, hasTouch: true, aiEnabled: true });

type BrowserContext = Pick<test.browser.Context, 'page' | 'expect' | 'expectScreenshot'>;

async function visit({ page, expect }: BrowserContext, path: string) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveCSS('zoom', '1');
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', phone.width);

  const main = page.locator('main');

  await expect(main).toBeVisible();
  const frame = await main.boundingBox();

  expect(frame?.width, `Writing and reading space on ${path}`).toBeGreaterThanOrEqual(
    phone.width * 0.8
  );
}

async function capture(context: BrowserContext, name: string, path: string, control: Locator) {
  const { expect, expectScreenshot } = context;

  await visit(context, path);
  await expectScreenshot(name, {
    target: 'viewport',
    zoomPercent: 100,
    ready: () => expect(control).toBeInViewport()
  });
}

test.browser.stable(
  'Mobile study pages use the available screen without desktop zoom',
  async ({ page, study, rpc, expect, expectScreenshot }) => {
    const { project, note, page: savedPage } = await study.seed();
    const settings = await rpc.runPromise(rpc.client['settings.appSettings']({}));
    const captureContext = { page, expect, expectScreenshot };
    const mainElement = page.locator('main');
    const main = page.getByRole('main');
    const subject = `?project=${project.id}`;

    const quiz = await rpc.runPromise(
      rpc.client['materials.create']({
        title: 'Chromosome check',
        projectId: project.id,
        content: {
          kind: 'quiz',
          questions: [
            {
              kind: 'true_false',
              prompt: 'Mitosis produces two daughter cells.',
              isTrue: true,
              explanation: 'Each daughter cell receives the same number of chromosomes.'
            }
          ]
        }
      })
    );
    const deck = await rpc.runPromise(
      rpc.client['materials.create']({
        title: 'Cell division cards',
        projectId: project.id,
        content: {
          kind: 'flashcards',
          cards: [{ front: 'How many daughter cells?', back: 'Two.' }]
        }
      })
    );
    const sourceText = 'Chromosomes carry genetic information.';
    const source = await rpc.runPromise(
      rpc.client['sources.createSource']({
        name: 'Study reference.txt',
        bytes: new TextEncoder().encode(sourceText),
        projectId: project.id
      })
    );

    expect(settings.zoomPercent).toBe(125);
    await capture(
      captureContext,
      'notes',
      '/',
      page.getByRole('textbox', { name: copy.NoteCompose })
    );
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('searchbox', { name: copy.Search, exact: true })).toBeFocused();
    await capture(
      captureContext,
      'notebook',
      `/notes/${note.id}`,
      page.getByRole('region', { name: copy.NoteNotebook })
    );
    await capture(
      captureContext,
      'subjects',
      `/projects${subject}`,
      main.getByRole('heading', { name: project.name, exact: true })
    );
    await capture(
      captureContext,
      'pages',
      `/pages${subject}`,
      main.getByRole('link', { name: savedPage.title, exact: false })
    );
    await capture(
      captureContext,
      'page-reader',
      `/pages/${savedPage.id}?pageVersion=${savedPage.version!.id}`,
      main.getByText(study.lecture, { exact: true })
    );
    await capture(
      captureContext,
      'assistant',
      '/assistant',
      page.getByRole('textbox', { name: copy.StudyChatMessage })
    );
    await capture(
      captureContext,
      'practice',
      `/practice${subject}`,
      page.getByRole('button', { name: copy.PracticeGenerate, exact: true })
    );
    await capture(
      captureContext,
      'quiz',
      `/practice/${quiz.id}`,
      main.getByRole('button', { name: copy.PracticeStartQuiz })
    );
    await capture(
      captureContext,
      'flashcards',
      `/flashcards${subject}`,
      page.getByRole('button', { name: copy.PracticeGenerate, exact: true })
    );
    await capture(
      captureContext,
      'flashcard-review',
      `/flashcards/${deck.id}`,
      main.getByText('How many daughter cells?', { exact: true })
    );
    await capture(
      captureContext,
      'material-reader',
      `/materials/${quiz.id}`,
      main.getByRole('heading', { name: quiz.title })
    );
    await capture(
      captureContext,
      'source-reader',
      `/sources/${source.id}`,
      main.getByText(sourceText, { exact: true })
    );

    const drawer = page.getByRole('complementary', { name: copy.SidebarNavigation });

    const reveal = main.getByRole('button', { name: copy.ToggleSidebar });
    const closeDrawer = drawer.getByRole('button', { name: copy.ToggleSidebar });

    await reveal.tap();
    await expect(closeDrawer).toBeFocused();
    await expect(mainElement).toHaveJSProperty('inert', true);
    await expectScreenshot('navigation-drawer', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(drawer).toBeInViewport()
    });
    await drawer.getByRole('link', { name: copy.SourcePage, exact: false }).tap();
    await expect(page).toHaveURL(/\/pages/);
    await expect(drawer).toBeHidden();
    await expect(main.getByRole('heading', { name: copy.PagesOverviewTitle })).toBeInViewport();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(drawer.getByRole('searchbox', { name: copy.Search, exact: true })).toBeFocused();
    await closeDrawer.tap();
    await expect(drawer).toBeHidden();
    await expect(mainElement).toHaveJSProperty('inert', false);
    await expect(reveal).toBeFocused();
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(main.getByRole('heading', { name: copy.PagesOverviewTitle })).toBeInViewport();
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 320);
    await expectScreenshot('pages-small-phone', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () =>
        expect(main.getByRole('heading', { name: copy.PagesOverviewTitle })).toBeInViewport()
    });
    await page.setViewportSize(phone);

    await page.goto('/settings');
    const settingsDialog = page.getByRole('dialog', { name: copy.Settings });

    const contrast = settingsDialog.getByRole('slider', { name: copy.AppearanceContrast });
    const textSize = settingsDialog.getByRole('slider', { name: copy.TextSize });
    const html = page.locator('html');

    await settingsDialog.getByRole('button', { name: copy.Appearance, exact: true }).tap();
    await contrast.scrollIntoViewIfNeeded();
    await expect(textSize).toHaveCount(0);
    await expectScreenshot('settings', {
      target: 'viewport',
      zoomPercent: 100,
      ready: () => expect(contrast).toBeInViewport()
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(html).toHaveCSS('zoom', '1.25');
    await expect(textSize).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(html).toHaveCSS('zoom', '1');
    await expect(textSize).toHaveCount(0);
    expect((await rpc.runPromise(rpc.client['settings.appSettings']({}))).zoomPercent).toBe(125);
  }
);
