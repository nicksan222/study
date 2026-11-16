import { StudyError } from '@study/contracts';
import { Appearance, Language, defaultQuizSettings } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type { Locator } from 'playwright';

test.stable.use({ aiEnabled: true, video: { mode: 'on', size: { width: 2560, height: 1440 } } });

const copy = catalogs.english;

const cards = {
  kind: 'flashcards' as const,
  cards: [
    {
      front: 'What does mitosis produce?',
      back: 'Two daughter cells with the same chromosome number. [1]'
    },
    { front: 'When is DNA copied?', back: 'Before cell division. [1]' }
  ]
};

async function itemSize(sidebar: Locator, title: string) {
  const box = await sidebar.locator('.study-note-row').filter({ hasText: title }).boundingBox();

  if (!box) throw new Error(`Sidebar item has no layout box: ${title}`);

  return { width: box.width, height: box.height };
}

test.stable(
  'Material generation progress and recovery',
  async ({ page, study, ai, expectScreenshot, expectAccessibility }) => {
    const fixture = await study.seed();
    const title = 'Cell division flashcards';
    const expected = ai.next(study.agents.flashcards, {
      input: { prompt: `Title: ${title}\nStudent instruction (data): ` },
      output: cards,
      hold: true
    });
    const request = await study.request({
      title,
      projectId: fixture.project.id,
      kind: 'flashcards',
      inputs: [fixture.input]
    });

    await expected.called;
    const practice = `/practice?project=${fixture.project.id}`;

    await page.goto(practice);
    await test.expect(page.getByText(title, { exact: true })).toBeVisible();
    await expectScreenshot('running', {
      target: page.locator('aside.study-sidebar'),
      ready: () => test.expect(page.getByText(title, { exact: true })).toBeVisible()
    });
    const sidebar = page.locator('aside.study-sidebar');
    const workingSize = await itemSize(sidebar, title);

    await test.expect(sidebar.getByText('Step 1', { exact: true })).toHaveCount(0);
    await page
      .getByRole('status', { name: copy.PracticeGenerationRunning })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).click();
    const details = page.getByRole('dialog', { name: copy.AgentActivityDetails });

    await expectScreenshot('running-details', {
      target: details,
      ready: () => test.expect(details.getByText('Step 1', { exact: true })).toBeVisible()
    });
    await expectAccessibility('generation-details');
    await details.getByRole('button', { name: copy.Close }).click();
    await test.expect(details).toHaveCount(0);
    const stopAction = sidebar.getByRole('button', {
      name: copy.PracticeGenerationStop.replace('{title}', title)
    });

    await stopAction.press('Shift+F10');
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).press('Enter');
    await test.expect(details).toBeVisible();
    await test.expect(details.getByRole('button', { name: copy.Close })).toBeFocused();
    await test.expect(page.getByRole('menu')).toHaveCount(0);
    await test.expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await test.expect(details).toHaveCount(0);

    await page.goto(`/notes/${fixture.note.id}`);
    await expectScreenshot('notes-work-running', {
      target: 'viewport',
      ready: () => test.expect(page.getByRole('region', { name: copy.NoteNotebook })).toBeVisible()
    });
    await page.goto(practice);
    expected.release();
    await test.expect
      .poll(async () => (await study.snapshot(request.id)).resultVersionId)
      .not.toBeNull();
    const version = await study.published(request.id);

    await page.goto(`/flashcards/${version.material_id}?project=${fixture.project.id}`);
    await expectScreenshot('flashcards-ready', {
      target: 'viewport',
      ready: () =>
        test.expect(page.getByText('What does mitosis produce?', { exact: true })).toBeVisible()
    });

    const failedTitle = 'Cell division review';

    ai.failNext(study.agents.flashcards, {
      input: { prompt: `Title: ${failedTitle}\nStudent instruction (data): ` },
      error: new StudyError('invalid_input', 'Controlled generation failure')
    });
    const failed = await study.request({
      title: failedTitle,
      projectId: fixture.project.id,
      kind: 'flashcards',
      inputs: [fixture.input]
    });

    await test.expect
      .poll(async () => (await study.snapshot(failed.id)).errorKind)
      .toBe('invalid_input');
    await page.goto(practice);
    await test
      .expect(page.getByRole('status', { name: copy.PracticeGenerationFailedStatus }))
      .toBeVisible();
    await test.expect(page.getByRole('button', { name: copy.Retry, exact: true })).toBeEnabled();
    await expectScreenshot('failed', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        test
          .expect(page.getByRole('button', { name: copy.PracticeGenerate, exact: true }))
          .toBeVisible()
    });
    test.expect(await itemSize(sidebar, failedTitle)).toEqual(workingSize);
    test.expect(await itemSize(sidebar, title)).toEqual(workingSize);
    await page.getByText(failedTitle, { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).click();
    await expectScreenshot('failed-details', {
      target: details,
      ready: () => test.expect(details.getByLabel(copy.AgentActivitySteps)).toBeVisible()
    });
    await expectAccessibility('generation-recovery-details');
    await details.getByRole('button', { name: copy.Close }).click();
    await study.settings({ appearance: Appearance.LIGHT });
    await page.reload();
    await expectScreenshot('failed-light', {
      target: sidebar,
      ready: () =>
        test
          .expect(page.getByRole('status', { name: copy.PracticeGenerationFailedStatus }))
          .toBeVisible()
    });
    test.expect(await itemSize(sidebar, failedTitle)).toEqual(workingSize);
    await expectAccessibility('generation-recovery-light');
    await page.getByText(failedTitle, { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).click();
    await expectScreenshot('failed-details-light', {
      target: details,
      ready: () => test.expect(details.getByLabel(copy.AgentActivitySteps)).toBeVisible()
    });
    await expectAccessibility('generation-recovery-details-light');
    await details.getByRole('button', { name: copy.Close }).click();
    await study.settings({ appearance: Appearance.DARK, language: Language.ITALIAN });
    await page.reload();
    await expectScreenshot('failed-italian', {
      target: sidebar,
      ready: () =>
        test
          .expect(
            page.getByRole('status', { name: catalogs.italian.PracticeGenerationFailedStatus })
          )
          .toBeVisible()
    });
    test.expect(await itemSize(sidebar, failedTitle)).toEqual(workingSize);
    await expectAccessibility('generation-recovery-italian');
    await study.settings({ appearance: Appearance.DARK, language: Language.ENGLISH });
    await page.reload();
    const retry = ai.next(study.agents.flashcards, {
      input: { prompt: `Title: ${failedTitle}\nStudent instruction (data): ` },
      output: cards,
      hold: true
    });

    await page.getByRole('button', { name: copy.Retry, exact: true }).click();
    await retry.called;
    await test.expect(page.getByRole('button', { name: copy.Retry, exact: true })).toHaveCount(0);
    await expectScreenshot('retrying', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        test
          .expect(page.getByRole('status', { name: copy.PracticeGenerationRetrying }))
          .toBeVisible()
    });
    test.expect(await itemSize(sidebar, failedTitle)).toEqual(workingSize);
    await expectAccessibility('generation-retrying');
    retry.release();
    await test.expect
      .poll(async () => (await study.snapshot(failed.id)).resultVersionId)
      .not.toBeNull();
    await test
      .expect(page.getByRole('status', { name: copy.PracticeGenerationRetrying }))
      .toHaveCount(0);
    const retryVersion = await study.published(failed.id);

    await page.goto(`/flashcards/${retryVersion.material_id}?project=${fixture.project.id}`);
    await expectScreenshot('retry-ready', {
      target: 'viewport',
      ready: () =>
        test.expect(page.getByText('What does mitosis produce?', { exact: true })).toBeVisible()
    });
    const stoppedTitle = 'Cell division extra practice';
    const stopping = ai.next(study.agents.flashcards, {
      input: { prompt: `Title: ${stoppedTitle}\nStudent instruction (data): ` },
      output: cards,
      hold: true
    });
    const stopped = await study.request({
      title: stoppedTitle,
      projectId: fixture.project.id,
      kind: 'flashcards',
      inputs: [fixture.input]
    });

    await stopping.called;
    await page.goto(practice);
    await page
      .getByRole('button', { name: copy.PracticeGenerationStop.replace('{title}', stoppedTitle) })
      .click();
    await test.expect.poll(async () => (await study.snapshot(stopped.id)).cancelled).toBe(true);
    await test.expect(page.getByText(stoppedTitle, { exact: true })).toHaveCount(0);
    await expectScreenshot('stopped', {
      target: page.locator('aside.study-sidebar'),
      ready: () => test.expect(page.getByText(stoppedTitle, { exact: true })).toHaveCount(0)
    });
    stopping.release();
    await test.expect
      .poll(async () =>
        (await study.executions(stopped.id)).items.some((run) => run.status === 'cancelled')
      )
      .toBe(true);
    test.expect((await study.snapshot(stopped.id)).resultVersionId).toBeNull();
  }
);

test.stable(
  'Long study notes prepare every section before final material',
  async ({ page, study, ai, expectScreenshot, expectAccessibility }) => {
    const fixture = await study.seed(`${study.lecture}\n\n`.repeat(180));
    const title = 'Full lecture flashcards';
    const context = await study.contextInputs(fixture, title);
    const maps = context.maps.map((call) =>
      ai.next(study.agents.studyNotes, { ...call, hold: true })
    );
    const reduction = ai.next(study.agents.studyNotes, { ...context.reduce, hold: true });
    const tail = context.reduce.output.notes.at(-1)!.markers[0]!;
    const output = {
      kind: 'flashcards' as const,
      cards: [
        cards.cards[0]!,
        {
          front: 'What should we retain from the end of the lecture?',
          back: `DNA is copied before division. [${tail}]`
        }
      ]
    };
    const final = ai.next(study.agents.flashcards, {
      input: { prompt: `Title: ${title}\nStudent instruction (data): ` },
      output,
      hold: true
    });
    const request = await study.request({
      title,
      projectId: fixture.project.id,
      kind: 'flashcards',
      inputs: [fixture.input]
    });

    await maps[0]!.called;
    await page.goto(`/practice?project=${fixture.project.id}`);
    const sidebar = page.locator('aside.study-sidebar');

    await test
      .expect(page.getByRole('status', { name: copy.AgentActivityPreparing }))
      .toBeVisible();
    await expectScreenshot('preparing-section', {
      target: sidebar,
      ready: () =>
        test.expect(page.getByRole('status', { name: copy.AgentActivityPreparing })).toBeVisible()
    });
    const preparingSize = await itemSize(sidebar, title);

    maps[0]!.release();
    await maps[1]!.called;
    await expectScreenshot('next-section', {
      target: sidebar,
      ready: () =>
        test.expect(page.getByRole('status', { name: copy.AgentActivityPreparing })).toBeVisible()
    });
    maps[1]!.release();
    await reduction.called;
    await expectScreenshot('combining-context', {
      target: sidebar,
      ready: () =>
        test.expect(page.getByRole('status', { name: copy.AgentActivityCompacting })).toBeVisible()
    });
    test.expect(await itemSize(sidebar, title)).toEqual(preparingSize);
    reduction.release();
    await final.called;
    await expectScreenshot('final-generation', {
      target: sidebar,
      ready: () =>
        test
          .expect(page.getByRole('status', { name: copy.PracticeGenerationRunning }))
          .toBeVisible()
    });
    test.expect(await itemSize(sidebar, title)).toEqual(preparingSize);
    await expectAccessibility('generation-current-phase');
    await test.expect(sidebar.getByText('Step 1', { exact: true })).toHaveCount(0);
    await page
      .getByRole('status', { name: copy.PracticeGenerationRunning })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).click();
    const details = page.getByRole('dialog', { name: copy.AgentActivityDetails });

    await expectScreenshot('preparation-details', {
      target: details,
      ready: () => test.expect(details.getByText('Step 4', { exact: true })).toBeVisible()
    });
    await details.getByRole('button', { name: copy.Close }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await study.settings({ language: Language.ITALIAN });
    await page.reload();
    const italian = catalogs.italian;

    await expectScreenshot('italian-narrow', {
      target: 'viewport',
      ready: () =>
        test
          .expect(page.getByRole('status', { name: italian.PracticeGenerationRunning }))
          .toBeVisible()
    });
    test.expect(await itemSize(sidebar, title)).toEqual(preparingSize);
    await expectAccessibility('generation-italian-narrow');
    await test
      .expect(sidebar.getByText(italian.AgentActivityStepComplete, { exact: true }))
      .toHaveCount(0);
    await page.setViewportSize({ width: 820, height: 540 });
    await expectScreenshot('italian-compact', {
      target: 'viewport',
      ready: () =>
        test
          .expect(
            page.getByRole('button', {
              name: italian.PracticeGenerationStop.replace('{title}', title)
            })
          )
          .toBeVisible()
    });
    test.expect(await itemSize(sidebar, title)).toEqual(preparingSize);
    await expectAccessibility('generation-italian-compact');
    await page.setViewportSize({ width: 1280, height: 900 });
    final.release();
    await test.expect
      .poll(async () => (await study.snapshot(request.id)).resultVersionId)
      .not.toBeNull();
    const version = await study.published(request.id);
    const citations = await study.citations(version.id);

    test.expect(citations.items.map((citation) => Number(citation.marker))).toContain(tail);
    await page.goto(`/flashcards/${version.material_id}?project=${fixture.project.id}`);
    await expectScreenshot('long-input-ready', {
      target: 'viewport',
      ready: () => test.expect(page.getByText(cards.cards[0]!.front, { exact: true })).toBeVisible()
    });
  }
);

test.stable(
  'Quiz generation uses the selected notes and saved question settings',
  async ({ page, study, ai, expectScreenshot, expectAccessibility }) => {
    const fixture = await study.seed();

    await study.quizPreferences({
      ...defaultQuizSettings,
      questionCount: 2,
      choiceCount: 3,
      questionKind: 'open',
      difficulty: 'balanced'
    });
    const generated = ai.next(study.agents.quiz, {
      input: {
        prompt: `Title: ${copy.SidebarQuiz}\nStudent instruction (data): \nQuiz requirements: produce exactly 2 questions. Question kind: only open questions. Every choice question must contain exactly 3 answer options. Difficulty: balanced (a balance of recall, understanding and application).`
      },
      output: {
        title: 'Cell division checkpoint',
        content: {
          kind: 'quiz',
          questions: [
            {
              kind: 'open',
              prompt: 'What does mitosis produce?',
              referenceAnswer: 'Two daughter cells.',
              explanation: 'Mitosis preserves chromosome number. [1]'
            },
            {
              kind: 'open',
              prompt: 'When is DNA copied?',
              referenceAnswer: 'Before cell division.',
              explanation: 'The lecture places DNA copying before division. [1]'
            }
          ]
        }
      },
      hold: true
    });

    await page.goto(`/practice?project=${fixture.project.id}`);
    await page.getByRole('button', { name: copy.PracticeGenerate, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: copy.PracticeGenerate });
    const start = dialog.getByRole('button', { name: copy.PracticeGenerateStart, exact: true });

    await test.expect(start).toBeEnabled();
    await expectScreenshot('quiz-request', {
      target: dialog,
      ready: () => test.expect(start).toBeEnabled()
    });
    await start.click();
    await generated.called;
    await test.expect(dialog).toBeHidden();
    const active = await study.active(fixture.project.id);

    test.expect(active).toHaveLength(1);
    await expectScreenshot('quiz-running', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        test
          .expect(page.getByRole('status', { name: copy.PracticeGenerationRunning }))
          .toBeVisible()
    });
    generated.release();
    await test.expect
      .poll(async () => (await study.snapshot(active[0]!.id)).resultVersionId)
      .not.toBeNull();
    const version = await study.published(active[0]!.id);

    test.expect(version.content.kind).toBe('quiz');

    if (version.content.kind === 'quiz') test.expect(version.content.questions).toHaveLength(2);

    await page.goto(`/practice/${version.material_id}?project=${fixture.project.id}`);
    await expectScreenshot('quiz-ready', {
      target: 'viewport',
      ready: () =>
        test
          .expect(page.getByRole('button', { name: copy.PracticeStartQuiz, exact: true }))
          .toBeVisible()
    });
    await expectAccessibility('generated-quiz');
  }
);
