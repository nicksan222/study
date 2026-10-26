import { test, expect } from '../fixtures';
import { catalogs } from '../../../apps/desktop/src/generated/catalog';
import { Appearance, Language, DueCardsRequestSchema } from '../../../apps/desktop/src/generated/study_pb';
import { fromBinary } from '@bufbuild/protobuf';
const en = catalogs.english;

test('project create, exam, rename and delete persist through the production UI', async ({ page, backend }) => {
  await page.goto('/#Projects');
  await page.getByRole('button', { name: en.NewProject, exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(en.ProjectName, { exact: false }).fill('Consumer genetics');
  await dialog.locator('input[type=date]').fill('2027-06-15');
  await dialog.getByRole('button', { name: en.CreateProject, exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await backend.projects({})).items.find(p => p.name === 'Consumer genetics')?.examOn?.day).toBe(15);
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Consumer genetics', exact: true }) });
  await panel.getByRole('button', { name: en.RenameProject, exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(en.ProjectName, { exact: false }).fill('Consumer molecular genetics');
  await dialog.getByRole('button', { name: en.Save, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consumer molecular genetics', exact: true })).toBeVisible();
  await page.reload();
  const renamed = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Consumer molecular genetics', exact: true }) });
  await renamed.getByRole('button', { name: en.DeleteProject, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: en.ConfirmDeleteProject, exact: true }).click();
  await expect.poll(async () => (await backend.projects({})).items.some(p => p.name.startsWith('Consumer '))).toBe(false);
});

test('notes create, source association, original download and deletion use real persistence', async ({ page, backend }) => {
  const projects = (await backend.projects({})).items;
  await page.goto('/#MediaList');
  await page.getByRole('button', { name: en.NewNote, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(en.NoteTitle, { exact: false }).fill('Consumer membrane notes');
  await dialog.getByPlaceholder(en.NoteBodyPlaceholder).fill('The membrane controls exchange across the cell boundary.');
  await dialog.getByRole('combobox').selectOption(projects[0].id!.value.toString());
  await dialog.getByRole('button', { name: en.SaveNote, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consumer membrane notes', exact: true })).toBeVisible();
  const source = (await backend.sources({})).items.find(s => s.name === 'Consumer membrane notes')!;
  expect(source.projectId?.value).toBe(projects[0].id!.value);
  const detail = page.locator('section').filter({ has: page.getByRole('heading', { name: source.name, exact: true }) });
  await detail.getByRole('combobox').selectOption(projects[1].id!.value.toString());
  await expect.poll(async () => (await backend.source(source.id!)).value?.projectId?.value.toString()).toBe(projects[1].id!.value.toString());
  const download = page.waitForEvent('download');
  await detail.getByRole('button', { name: en.OpenOriginal, exact: true }).click();
  expect((await download).suggestedFilename()).toContain('Consumer membrane notes');
  await detail.getByRole('button', { name: en.DeleteMedia, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: en.ConfirmDeleteMedia, exact: true }).click();
  await expect.poll(async () => (await backend.source(source.id!)).value === undefined).toBe(true);
});

test('browser upload stages bytes and imports using the same production file action', async ({ page, backend }) => {
  await page.goto('/#MediaList');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: en.AddFiles, exact: true }).click();
  await (await chooser).setFiles({ name: 'consumer-lecture.txt', mimeType: 'text/plain', buffer: Buffer.from('A genuine imported lecture about genetics.') });
  await expect.poll(async () => (await backend.sources({})).items.some(s => s.name === 'consumer-lecture.txt')).toBe(true);
  await page.getByRole('button', { name: /consumer-lecture\.txt/ }).click();
  await expect(page.getByRole('heading', { name: 'consumer-lecture.txt', exact: true })).toBeVisible();
  const imported = (await backend.sources({})).items.find(s => s.name === 'consumer-lecture.txt')!;
  expect(new TextDecoder().decode((await backend.exportSource(imported.id!)).value)).toBe('A genuine imported lecture about genetics.');
});

test('session create and delete preserve selected project and title', async ({ page, backend }) => {
  await page.goto('/#Sessions');
  await page.getByRole('button', { name: en.NewSession, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Consumer seminar');
  await dialog.getByRole('button', { name: en.StartSession, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consumer seminar', exact: true })).toBeVisible();
  const session = (await backend.allSessions({})).items.find(s => s.title === 'Consumer seminar')!;
  expect(session.projectId?.value).toBeGreaterThan(0n);
  await page.reload();
  await page.getByRole('button', { name: en.DeleteSession, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: en.ConfirmDeleteSession, exact: true }).click();
  await expect.poll(async () => (await backend.session(session.id!)).value === undefined).toBe(true);
});

test('appearance and language survive reload and actual processing preferences persist', async ({ page, backend }) => {
  await page.goto('/#Settings');
  await page.getByRole('button', { name: en.Dark, exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect.poll(async () => (await backend.getAppSettings({})).appearance).toBe(Appearance.DARK);
  await page.getByRole('button', { name: en.ItalianOwnName, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect((await backend.getAppSettings({})).language).toBe(Language.ITALIAN);
  await page.getByRole('button', { name: catalogs.italian.EnglishOwnName, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: en.Processing, exact: true }).click();
  const before = (await backend.processing({})).switches[0];
  const first = page.getByRole('checkbox').first();
  await first.setChecked(!before.on);
  await expect.poll(async () => (await backend.processing({})).switches[0].on).toBe(!before.on);
  await page.getByLabel(en.NewCardsPerDay, { exact: false }).fill('17');
  await page.getByRole('button', { name: en.Save, exact: true }).click();
  await expect.poll(async () => (await backend.getReviewSettings({})).newCardsPerDay).toBe(17);
});

test('seeded flashcards can be edited, added and reviewed without inference', async ({ page, backend }) => {
  await page.goto('/#Flashcards');
  await page.getByRole('button', { name: en.EditCard, exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(en.CardFront, { exact: false }).fill('Consumer cell question');
  await dialog.getByLabel(en.CardBack, { exact: false }).fill('Consumer cell answer');
  await dialog.getByRole('button', { name: en.SaveCard, exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Cell biology', exact: true }).getByText('Consumer cell question', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: en.AddCard, exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(en.CardFront, { exact: false }).fill('Consumer extra card');
  await dialog.getByLabel(en.CardBack, { exact: false }).fill('A durable answer');
  await dialog.getByRole('button', { name: en.SaveCard, exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: en.ReviewDue, exact: false }).first().click();
  await expect(page.getByRole('button', { name: en.ShowAnswer, exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: `3 · ${en.RateGood}`, exact: true })).toBeVisible();
  const before = (await backend.reviewTimes({ since: 0n })).items.length;
  await page.getByRole('button', { name: `3 · ${en.RateGood}`, exact: true }).click();
  await expect.poll(async () => (await backend.reviewTimes({ since: 0n })).items.length).toBe(before + 1);
});

test('seeded practice results and diagrams render through actual RPC', async ({ page, backend }) => {
  const practices = (await backend.practices({})).items;
  expect(practices.length).toBeGreaterThan(0);
  await page.goto(`/#Practice?id=${practices[0].id!.value}`);
  await page.getByRole('button', { name: en.PracticeResults, exact: true }).click();
  await expect(page.getByRole('heading', { name: en.PracticeResults, exact: true })).toBeVisible();
  await page.goto('/#Diagrams');
  await expect(page.locator('.study-diagram svg')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en.SaveImage, exact: true }).last().click();
  expect((await download).suggestedFilename()).toBe('Study.svg');
});

test('global search uses the real index and opens a persisted project', async ({ page, backend }) => {
  const project = await backend.createProject({ name: 'Consumer searchable project' });
  await page.goto('/');
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: en.Search, exact: true }).fill(project.name);
  await dialog.getByRole('button', { name: new RegExp(project.name) }).click();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
});

// Inspect the actual consumer request without intercepting or replacing transport.
for (const entry of ['home', 'mounted-material'] as const) {
  test(`global review starts directly from ${entry} through production routing`, async ({ page, backend }) => {
    expect((await backend.dueCards({ limit: 1000n })).items.length).toBeGreaterThan(0);
    await page.goto(entry === 'home' ? '/' : '/#Flashcards');
    if (entry === 'home') await expect(page.getByRole('button', { name: en.ReviewNow, exact: true })).toBeVisible();
    else await expect(page.getByRole('button', { name: en.StartReview, exact: false })).toBeVisible();
    const sent = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/study.v1.Study/DueCards'));
    if (entry === 'home') await page.getByRole('button', { name: en.ReviewNow, exact: true }).click();
    else await page.evaluate(() => { window.location.hash = 'Flashcards?id=review'; });
    const request = await sent;
    const payload = request.postDataBuffer();
    expect(payload).not.toBeNull();
    expect(fromBinary(DueCardsRequestSchema, payload!).project).toBeUndefined();
    await expect(page.getByRole('combobox', { name: en.ReviewsByProject, exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: en.ShowAnswer, exact: true })).toBeVisible();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const history = await backend.reviewTimes({ since: now - 7n * 86400n });
    const upcoming = await backend.dueBy({ until: now + 7n * 86400n });
    await expect(page.getByRole('heading', { name: `${en.ReviewProgress} · ${en.AllProjects}`, exact: true })).toBeVisible();
    await expect(page.getByText(`${history.items.length} · ${en.ProgressCompleted}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${upcoming.value} · ${en.ProgressComingUp}`, { exact: true })).toBeVisible();
  });
}


test('overlapping language and shell zoom compose through real RPC and survive reload', async ({ page, backend }) => {
  await page.goto('/#Settings');
  const language = page.getByRole('button', { name: en.ItalianOwnName, exact: true });
  await expect(language).toBeEnabled();
  // Deliver both real UI actions before either network round trip can finish.
  await language.evaluate(button => {
    (button as HTMLButtonElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true }));
  });
  await expect.poll(async () => {
    const settings = await backend.getAppSettings({});
    return { language: settings.language, zoom: settings.zoomPercent };
  }).toEqual({ language: Language.ITALIAN, zoom: 110 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.locator('html')).toHaveCSS('zoom', '1.1');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  await expect(page.locator('html')).toHaveCSS('zoom', '1.1');
});
