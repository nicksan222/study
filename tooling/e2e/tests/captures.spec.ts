import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { catalogs, type MessageKey } from '../../../apps/desktop/src/generated/catalog';
import { Appearance, Language, JobStatus, QuestionStatus } from '../../../apps/desktop/src/generated/study_pb';
import { createStudyClient } from '../../../apps/desktop/src/rpc/client';
import { clip, still, demo } from '../media';

type Scene = { name: string; route: MessageKey; video?: boolean };
// Names describe observable states; each non-overview scene asserts its distinguishing action.
const scenes: Scene[] = [
  { name: 'home', route: 'Home' },
  { name: 'library', route: 'MediaList' },
  { name: 'new-note', route: 'MediaList' },
  { name: 'add-link', route: 'MediaList' },
  { name: 'add-files', route: 'MediaList' },
  { name: 'source-details', route: 'MediaList' },
  { name: 'session', route: 'Sessions' },
  { name: 'citation', route: 'Sessions' },
  { name: 'study-question', route: 'Sessions' },
  { name: 'study-mention', route: 'Sessions', video: true },
  { name: 'citation-open', route: 'Sessions', video: true },
  { name: 'attachment-thread', route: 'Sessions' },
  { name: 'new-session', route: 'Sessions' },
  { name: 'new-project', route: 'Projects' },
  { name: 'search', route: 'Home' },
  { name: 'search-typing', route: 'Home', video: true },
  { name: 'flashcards', route: 'Flashcards' },
  { name: 'flashcard-deck', route: 'Flashcards' },
  { name: 'flashcard', route: 'Flashcards' },
  { name: 'flashcard-flip', route: 'Flashcards', video: true },
  { name: 'diagram', route: 'Diagrams' },
  { name: 'diagram-cells', route: 'Diagrams' },
  { name: 'diagram-zoom', route: 'Diagrams', video: true },
  { name: 'diagram-drag', route: 'Diagrams', video: true },
  { name: 'practice', route: 'Practice' },
  { name: 'graded', route: 'Practice' },
  { name: 'practice-feedback', route: 'Practice' },
  { name: 'practice-results', route: 'Practice', video: true },
  { name: 'settings', route: 'Settings' },
  { name: 'settings-appearance', route: 'Settings' },
  { name: 'settings-models', route: 'Settings' },
  { name: 'settings-processing', route: 'Settings' },
  { name: 'activity', route: 'Pipelines' },
  { name: 'activity-queued', route: 'Pipelines' },
];
const root = resolve(import.meta.dirname, '../../..');
const filters = (process.env.STUDY_CAPTURE_FILTER ?? '').split(/\s+/).filter(Boolean);
const variants = [
  { name: 'en-light', language: Language.ENGLISH, appearance: Appearance.LIGHT, copy: catalogs.english },
  { name: 'en-dark', language: Language.ENGLISH, appearance: Appearance.DARK, copy: catalogs.english },
  { name: 'it-light', language: Language.ITALIAN, appearance: Appearance.LIGHT, copy: catalogs.italian },
  { name: 'it-dark', language: Language.ITALIAN, appearance: Appearance.DARK, copy: catalogs.italian },
];

async function prepare(page: Page, scene: Scene, copy: typeof catalogs.english | typeof catalogs.italian, backend: ReturnType<typeof createStudyClient>) {
  const button = (key: MessageKey) => page.getByRole('button', { name: copy[key], exact: true });
  const sessionScenes = ['session', 'study-question', 'study-mention', 'citation', 'citation-open', 'attachment-thread'];
  if (sessionScenes.includes(scene.name)) {
    await page.getByRole('button', { name: 'Mitosis lecture', exact: true }).click();
    await expect(page.getByPlaceholder(copy.ComposerPlaceholder)).toBeVisible();
  }
  switch (scene.name) {
    case 'new-project':
      await button('NewProject').click();
      await page.getByRole('dialog').getByLabel(copy.ProjectName, { exact: false }).fill('Genetics');
      await expect(page.getByRole('dialog').getByRole('button', { name: copy.CreateProject, exact: true })).toBeEnabled();
      break;
    case 'new-note':
      await button('NewNote').click();
      await page.getByRole('dialog').getByLabel(copy.NoteTitle, { exact: false }).fill('Cell cycle');
      await page.getByPlaceholder(copy.NoteBodyPlaceholder).fill('Interphase, mitosis and cytokinesis.');
      await expect(page.getByRole('dialog').getByRole('button', { name: copy.SaveNote, exact: true })).toBeEnabled();
      break;
    case 'add-link':
      await button('AddLink').click();
      await page.getByRole('dialog').getByRole('textbox').fill('https://example.org/lecture');
      await expect(page.getByRole('dialog').getByRole('button', { name: copy.AddLink, exact: true })).toBeEnabled();
      break;
    case 'add-files': {
      const chooser = page.waitForEvent('filechooser');
      await button('AddFiles').click();
      await (await chooser).setFiles({ name: 'lecture-outline.txt', mimeType: 'text/plain', buffer: Buffer.from('Cell cycle outline: interphase, mitosis, cytokinesis.') });
      const uploaded = page.getByRole('button', { name: /lecture-outline\.txt/ });
      await expect(uploaded).toBeVisible();
      const source = (await backend.sources({})).items.find(source => source.name === 'lecture-outline.txt');
      expect(source?.sizeBytes).toBe(BigInt(Buffer.byteLength('Cell cycle outline: interphase, mitosis, cytokinesis.')));
      break;
    }
    case 'new-session':
      await button('NewSession').click();
      await page.getByRole('dialog').getByRole('textbox').fill('Cell cycle revision');
      await page.getByRole('dialog').getByRole('button', { name: copy.StartSession, exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Cell cycle revision', exact: true })).toBeVisible();
      await expect(page.getByPlaceholder(copy.ComposerPlaceholder)).toBeEmpty();
      break;
    case 'study-question':
    case 'study-mention': {
      await button('AskAssistant').click();
      const composer = page.getByPlaceholder(copy.ComposerPlaceholder);
      await expect(composer).toHaveValue('@study ');
      await composer.pressSequentially('which phase ends mitosis?', { delay: scene.video ? 65 : 0 });
      await expect(composer).toHaveValue('@study which phase ends mitosis?');
      break;
    }
    case 'citation':
    case 'citation-open': {
      await page.locator('summary').filter({ hasText: copy.AnswerSources }).first().click();
      await page.getByRole('button', { name: /^\[1\]/ }).first().click();
      await expect(page).toHaveURL(/#MediaList\?.*anchor=/);
      await expect(page.locator('[data-cited=true]').first()).toBeVisible();
      break;
    }
    case 'attachment-thread':
      await page.getByRole('button', { name: new RegExp(copy.ReplyInThread) }).first().click();
      await expect(page.getByRole('dialog').getByPlaceholder(copy.ThreadComposerPlaceholder)).toBeVisible();
      await expect(page.getByRole('dialog').locator('h3')).not.toBeEmpty();
      break;
    case 'source-details':
      await page.getByRole('button', { name: /slides-mitosis\.pdf/ }).click();
      await expect(page.getByRole('heading', { name: 'slides-mitosis.pdf', exact: true })).toBeVisible();
      await expect(page.locator('.study-preview')).toBeVisible();
      break;
    case 'flashcard':
    case 'flashcard-flip': {
      await page.getByRole('button', { name: copy.ReviewDue, exact: false }).first().click();
      await button('ShowAnswer').click();
      const good = page.getByRole('button', { name: `3 · ${copy.RateGood}`, exact: true });
      await expect(good).toBeVisible();
      if (scene.video) {
        const before = (await backend.reviewTimes({ since: 0n })).items.length;
        await good.click();
        await expect.poll(async () => (await backend.reviewTimes({ since: 0n })).items.length).toBe(before + 1);
        await expect(button('ShowAnswer')).toBeVisible();
      }
      break;
    }
    case 'flashcard-deck':
      await button('FlashcardsShowAll').click();
      await expect(button('FlashcardsHideAll')).toBeVisible();
      await expect(button('EditCard').first()).toBeVisible();
      break;
    case 'diagram':
    case 'diagram-cells':
    case 'diagram-zoom':
    case 'diagram-drag': {
      const projects = (await backend.projects({})).items;
      const chosen = scene.name === 'diagram' ? projects.find(project => project.name !== 'Cell biology')! : projects.find(project => project.name === 'Cell biology')!;
      await page.getByRole('button', { name: chosen.name, exact: true }).click();
      await expect(page.locator('.study-diagram svg')).toBeVisible();
      if (scene.name === 'diagram-zoom') {
        const zoom = page.locator('output').first();
        await button('DiagramActualSize').click();
        await expect(zoom).toHaveText('100%');
        await button('DiagramZoomIn').click();
        await expect(zoom).toHaveText('125%');
        await button('DiagramZoomOut').click();
        await expect(zoom).toHaveText('100%');
      }
      if (scene.name === 'diagram-drag') {
        const canvas = page.getByRole('application', { name: copy.Diagrams, exact: true });
        const drawing = canvas.locator(':scope > div');
        await button('DiagramActualSize').click();
        const before = await drawing.evaluate(element => element.style.transform);
        const bounds = (await canvas.boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .4);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * .4 + 100, bounds.y + bounds.height * .4 + 70, { steps: 12 });
        await page.mouse.up();
        await expect.poll(() => drawing.evaluate(element => element.style.transform)).not.toBe(before);
      }
      break;
    }
    case 'practice':
    case 'graded':
    case 'practice-feedback':
    case 'practice-results': {
      await page.locator('.study-split > section button').first().click();
      const practice = (await backend.practice((await backend.practices({})).items[0].id!)).value!;
      const ready = practice.questions.find(question => question.status === QuestionStatus.READY)!;
      await expect(page.getByRole('heading', { name: ready.written!.gist, exact: true })).toBeVisible();
      await expect(page.getByRole('radio').first()).toBeEnabled();
      if (scene.name !== 'practice') {
        await button('PracticeResults').click();
        const graded = practice.questions.filter(question => question.status === QuestionStatus.GRADED);
        const firstHeading = page.getByRole('heading', { name: graded[0].written!.gist, exact: true });
        await firstHeading.scrollIntoViewIfNeeded();
        await expect(firstHeading).toBeInViewport();
        if (scene.name === 'practice-feedback') {
          const feedback = graded.at(-1)!;
          const heading = page.getByRole('heading', { name: feedback.written!.gist, exact: true });
          await heading.scrollIntoViewIfNeeded();
          await expect(heading).toBeInViewport();
          await expect(firstHeading).not.toBeInViewport();
          const panel = page.locator('section').filter({ has: heading });
          await expect(panel.getByText(copy.VerdictCorrect, { exact: true })).toBeVisible();
          await expect(panel.getByRole('radio').first()).toBeDisabled();
        }
      }
      break;
    }
    case 'settings-appearance':
      await page.getByLabel(copy.TextSize, { exact: false }).selectOption('125');
      await expect.poll(async () => (await backend.getAppSettings({})).zoomPercent).toBe(125);
      break;
    case 'settings-processing':
      await button('Processing').click();
      await expect(page.getByRole('checkbox').first()).toBeVisible();
      break;
    case 'settings-models':
      await button('Llm').click();
      await expect(button('LlmChatGptSignIn')).toBeVisible();
      break;
    case 'search':
    case 'search-typing':
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').getByRole('textbox').pressSequentially('Cell', { delay: 150 });
      await expect(page.getByRole('dialog').getByRole('button', { name: /Cell biology/ }).first()).toBeVisible();
      break;
    case 'activity-queued': {
      const queued = (await backend.jobOverviews({ limit: 500n })).items.filter(item => item.job?.status === JobStatus.QUEUED);
      expect(queued.length).toBeGreaterThan(0);
      await page.getByRole('combobox', { name: copy.FilterAll, exact: true }).selectOption(String(JobStatus.QUEUED));
      await expect(page.locator('.study-page section')).toHaveCount(queued.length);
      break;
    }
    default:
      await expect(page.locator('.study-page section').first()).toBeVisible();
  }
}

if (process.env.STUDY_CAPTURE === 'docs') {
  const unknown = filters.filter(filter => filter !== 'missing' && !scenes.some(scene => scene.name === filter) && !variants.some(variant => variant.name === filter));
  if (unknown.length) throw new Error(`Unknown capture filters: ${unknown.join(', ')}`);
  test.use({ video: 'on', viewport: { width: 1440, height: 960 } });
  for (const variant of variants) for (const scene of scenes) {
    const selectedScenes = filters.filter(filter => scenes.some(s => s.name === filter));
    const selectedVariants = filters.filter(filter => variants.some(v => v.name === filter));
    if ((selectedScenes.length && !selectedScenes.includes(scene.name)) || (selectedVariants.length && !selectedVariants.includes(variant.name))) continue;
    const base = resolve(root, `apps/landing/src/assets/${scene.video ? 'clips' : 'shots'}/${scene.name}-${variant.name}`);
    if (filters.includes('missing') && existsSync(`${base}.webp`) && (!scene.video || existsSync(`${base}.mp4`))) continue;
    test(`@capture ${scene.name} ${variant.name}`, async ({ page, backend }, info) => {
      const settings = await backend.getAppSettings({});
      await backend.saveAppSettings({ ...settings, language: variant.language, appearance: variant.appearance });
      await page.goto(`/#${scene.route}`);
      await expect(page.locator('html')).toHaveAttribute('lang', variant.name.startsWith('it') ? 'it' : 'en');
      await expect(page.locator('main > header h1')).toHaveText(variant.copy[scene.route]);
      const start = Date.now();
      await prepare(page, scene, variant.copy, backend);
      await page.mouse.move(0, 0);
      // Intentional media hold follows assertions of the completed named interaction.
      await page.waitForTimeout(scene.video ? 900 : 300);
      await expect(page.getByRole('alert')).toHaveCount(0);
      const png = info.outputPath('capture.png');
      await page.screenshot({ path: png });
      await still(png, `${base}.webp`);
      if (scene.video) {
        const recording = page.video()!;
        const seconds = Math.max(2, Math.ceil((Date.now() - start) / 1000));
        await page.close();
        await clip(await recording.path(), `${base}.mp4`, seconds);
      }
    });
  }
}

if (process.env.STUDY_CAPTURE === 'demo') {
  test.use({ video: 'on', viewport: { width: 1440, height: 960 } });
  test('@demo production study tour', async ({ page, backend }, info) => {
    test.setTimeout(120_000);
    await page.goto('/');
    const tour = ['home', 'add-files', 'study-mention', 'attachment-thread', 'citation-open', 'flashcard-flip', 'diagram-zoom', 'practice-results'] as const;
    for (const name of tour) {
      const scene = scenes.find(scene => scene.name === name)!;
      await page.goto(`/#${scene.route}`);
      await expect(page.locator('main > header h1')).toHaveText(catalogs.english[scene.route]);
      await prepare(page, scene, catalogs.english, backend);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(700);
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
    const recording = page.video()!;
    await page.close();
    await demo(await recording.path(), resolve(root, process.env.STUDY_DEMO_OUTPUT ?? 'apps/landing/public/demo.gif'));
    await info.attach('demo', { path: resolve(root, process.env.STUDY_DEMO_OUTPUT ?? 'apps/landing/public/demo.gif'), contentType: 'image/gif' });
  });
}
