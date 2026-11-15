import { StudyError } from '@study/contracts/errors';
import { Language, defaultQuizSettings } from '@study/contracts/settings/types';
import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

testE2e.use({ aiEnabled: true, video: { mode: 'on', size: { width: 2560, height: 1440 } } });

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

testE2e(
  'Material generation progress and recovery',
  async ({ page, study, ai, expectScreenshot }) => {
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
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expectScreenshot('running', {
      target: page.locator('aside.study-sidebar'),
      ready: () => expect(page.getByText(title, { exact: true })).toBeVisible()
    });
    const activity = page.locator('.study-sidebar-work-progress details');

    await expect(activity).not.toHaveAttribute('open');
    await activity.locator('summary').press('Enter');
    await expect(page.getByLabel(copy.AgentActivitySteps)).toBeVisible();
    await expectScreenshot('running-expanded', {
      target: page.locator('aside.study-sidebar'),
      ready: () => expect(page.getByLabel(copy.AgentActivitySteps)).toBeVisible()
    });
    await page.goto(`/notes/${fixture.note.id}`);
    await expectScreenshot('notes-work-running', {
      target: 'viewport',
      ready: () => expect(page.getByRole('region', { name: copy.NoteNotebook })).toBeVisible()
    });
    await page.goto(practice);
    expected.release();
    await expect
      .poll(async () => (await study.snapshot(request.id)).resultVersionId)
      .not.toBeNull();
    const version = await study.published(request.id);

    await page.goto(`/flashcards/${version.material_id}?project=${fixture.project.id}`);
    await expectScreenshot('flashcards-ready', {
      target: 'viewport',
      ready: () =>
        expect(page.getByText('What does mitosis produce?', { exact: true })).toBeVisible()
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

    await expect
      .poll(async () => (await study.snapshot(failed.id)).errorKind)
      .toBe('invalid_input');
    await page.goto(practice);
    await expect(
      page.getByRole('status', { name: copy.PracticeGenerationAttention })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: copy.Retry, exact: true })).toBeEnabled();
    await expectScreenshot('failed', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        expect(page.getByRole('button', { name: copy.PracticeGenerate, exact: true })).toBeVisible()
    });
    await activity.locator('summary').press('Enter');
    await expectScreenshot('failed-expanded', {
      target: page.locator('aside.study-sidebar'),
      ready: () => expect(page.getByLabel(copy.AgentActivitySteps)).toBeVisible()
    });
    const retry = ai.next(study.agents.flashcards, {
      input: { prompt: `Title: ${failedTitle}\nStudent instruction (data): ` },
      output: cards,
      hold: true
    });

    await page.getByRole('button', { name: copy.Retry, exact: true }).click();
    await retry.called;
    await expect(page.getByRole('button', { name: copy.Retry, exact: true })).toBeDisabled();
    await expectScreenshot('retrying', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        expect(page.getByRole('status', { name: copy.PracticeGenerationRetrying })).toBeVisible()
    });
    retry.release();
    await expect.poll(async () => (await study.snapshot(failed.id)).resultVersionId).not.toBeNull();
    await expect(page.getByRole('status', { name: copy.PracticeGenerationRetrying })).toHaveCount(
      0
    );
    const retryVersion = await study.published(failed.id);

    await page.goto(`/flashcards/${retryVersion.material_id}?project=${fixture.project.id}`);
    await expectScreenshot('retry-ready', {
      target: 'viewport',
      ready: () =>
        expect(page.getByText('What does mitosis produce?', { exact: true })).toBeVisible()
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
    await expect.poll(async () => (await study.snapshot(stopped.id)).cancelled).toBe(true);
    await expect(page.getByText(stoppedTitle, { exact: true })).toHaveCount(0);
    await expectScreenshot('stopped', {
      target: page.locator('aside.study-sidebar'),
      ready: () => expect(page.getByText(stoppedTitle, { exact: true })).toHaveCount(0)
    });
    stopping.release();
    await expect
      .poll(async () =>
        (await study.executions(stopped.id)).items.some((run) => run.status === 'cancelled')
      )
      .toBe(true);
    expect((await study.snapshot(stopped.id)).resultVersionId).toBeNull();
  }
);

testE2e(
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
    const activity = page.locator('.study-sidebar-work-progress details');

    await activity.locator('summary').press('Enter');
    await expectScreenshot('preparing-section', {
      target: page.locator('aside.study-sidebar'),
      ready: () => expect(page.getByLabel(copy.AgentActivitySteps)).toBeVisible()
    });
    maps[0]!.release();
    await maps[1]!.called;
    await expectScreenshot('next-section', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        expect(page.getByText(copy.AgentActivityStepCompleted, { exact: true })).toBeVisible()
    });
    maps[1]!.release();
    await reduction.called;
    await expectScreenshot('combining-context', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        expect(
          page.getByText(copy.AgentActivityStepsCompleted.replace('{count}', '2'), { exact: true })
        ).toBeVisible()
    });
    reduction.release();
    await final.called;
    await expectScreenshot('final-generation', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        expect(
          page.getByText(copy.AgentActivityStepsCompleted.replace('{count}', '3'), { exact: true })
        ).toBeVisible()
    });
    await expectAccessibility('generation-steps');
    await page.setViewportSize({ width: 1280, height: 900 });
    await study.language(Language.ITALIAN);
    await page.reload();
    const italian = catalogs.italian;

    await activity.locator('summary').press('Enter');
    await expectScreenshot('italian-narrow', {
      target: 'viewport',
      ready: () =>
        expect(page.getByRole('status', { name: italian.PracticeGenerationRunning })).toBeVisible()
    });
    await expectAccessibility('generation-italian-narrow');
    final.release();
    await expect
      .poll(async () => (await study.snapshot(request.id)).resultVersionId)
      .not.toBeNull();
    const version = await study.published(request.id);
    const citations = await study.citations(version.id);

    expect(citations.items.map((citation) => Number(citation.marker))).toContain(tail);
    await page.goto(`/flashcards/${version.material_id}?project=${fixture.project.id}`);
    await expectScreenshot('long-input-ready', {
      target: 'viewport',
      ready: () => expect(page.getByText(cards.cards[0]!.front, { exact: true })).toBeVisible()
    });
  }
);

testE2e(
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

    await expect(start).toBeEnabled();
    await expectScreenshot('quiz-request', {
      target: dialog,
      ready: () => expect(start).toBeEnabled()
    });
    await start.click();
    await generated.called;
    await expect(dialog).toBeHidden();
    const active = await study.active(fixture.project.id);

    expect(active).toHaveLength(1);
    await expectScreenshot('quiz-running', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        expect(page.getByRole('status', { name: copy.PracticeGenerationRunning })).toBeVisible()
    });
    generated.release();
    await expect
      .poll(async () => (await study.snapshot(active[0]!.id)).resultVersionId)
      .not.toBeNull();
    const version = await study.published(active[0]!.id);

    expect(version.content.kind).toBe('quiz');

    if (version.content.kind === 'quiz') expect(version.content.questions).toHaveLength(2);

    await page.goto(`/practice/${version.material_id}?project=${fixture.project.id}`);
    await expectScreenshot('quiz-ready', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('button', { name: copy.PracticeStartQuiz, exact: true })
        ).toBeVisible()
    });
    await expectAccessibility('generated-quiz');
  }
);
