import { StudyError } from '@study/contracts';
import type { ProjectId } from '@study/contracts';
import { Appearance, Language, defaultQuizSettings } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type { Locator } from 'playwright';
import type { Page } from 'playwright';

test.browser.use({ aiEnabled: true, video: { mode: 'on', size: { width: 2560, height: 1440 } } });

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

test.browser.stable(
  'Material generation progress and recovery',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const fixture = await study.seed();
    const title = 'Cell division flashcards';
    const expected = study.generate(study.agents.flashcards, {
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
    const sidebar = page.locator('aside.study-sidebar');
    const workingSize = await itemSize(sidebar, title);

    await expect(sidebar.getByText('Step 1', { exact: true })).toHaveCount(0);
    await page.getByRole('status', { name: copy.AgentRunFlashcards }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).click();
    const details = page.getByRole('dialog', { name: copy.AgentActivityDetails });

    await expectScreenshot('running-details', {
      target: details,
      ready: () =>
        expect(
          details.getByRole('button', {
            name: `${copy.AgentRunFlashcards} ${copy['workspace.state.running']}`,
            exact: true
          })
        ).toBeVisible()
    });
    await expectAccessibility('generation-details');
    await details.getByRole('button', { name: copy.Close }).click();
    await expect(details).toHaveCount(0);
    const stopAction = sidebar.getByRole('button', {
      name: copy.PracticeGenerationStop.replace('{title}', title)
    });

    await stopAction.press('Shift+F10');
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).press('Enter');
    await expect(details).toBeVisible();
    await expect(
      details
        .getByRole('button', {
          name: `${copy.AgentRunMaterial} ${copy['workspace.state.running']}`,
          exact: true
        })
        .first()
    ).toBeFocused();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);

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

    const history = study.history(version);
    const failedTitle = 'Cell division review';

    study.failGeneration(
      study.agents.flashcards,
      {
        input: { prompt: `Title: ${failedTitle}\nStudent instruction (data): ` },
        error: new StudyError('invalid_input', 'Controlled generation failure')
      },
      history
    );
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
      page.getByRole('status', { name: copy.PracticeGenerationFailedStatus })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: copy.Retry, exact: true })).toBeEnabled();
    await expectScreenshot('failed', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        expect(page.getByRole('button', { name: copy.PracticeGenerate, exact: true })).toBeVisible()
    });
    expect(await itemSize(sidebar, failedTitle)).toEqual(workingSize);
    expect(await itemSize(sidebar, title)).toEqual(workingSize);
    await page.getByText(failedTitle, { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).click();
    await expectScreenshot('failed-details', {
      target: details,
      ready: () => expect(details.getByLabel(copy.AgentActivitySteps)).toBeVisible()
    });
    await expectAccessibility('generation-recovery-details');
    await details.getByRole('button', { name: copy.Close }).click();
    await study.settings({ appearance: Appearance.LIGHT });
    await page.reload();
    await expectScreenshot('failed-light', {
      target: sidebar,
      ready: () =>
        expect(
          page.getByRole('status', { name: copy.PracticeGenerationFailedStatus })
        ).toBeVisible()
    });
    expect(await itemSize(sidebar, failedTitle)).toEqual(workingSize);
    await expectAccessibility('generation-recovery-light');
    await page.getByText(failedTitle, { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).click();
    await expectScreenshot('failed-details-light', {
      target: details,
      ready: () => expect(details.getByLabel(copy.AgentActivitySteps)).toBeVisible()
    });
    await expectAccessibility('generation-recovery-details-light');
    await details.getByRole('button', { name: copy.Close }).click();
    await study.settings({ appearance: Appearance.DARK, language: Language.ITALIAN });
    await page.reload();
    await expectScreenshot('failed-italian', {
      target: sidebar,
      ready: () =>
        expect(
          page.getByRole('status', { name: catalogs.italian.PracticeGenerationFailedStatus })
        ).toBeVisible()
    });
    expect(await itemSize(sidebar, failedTitle)).toEqual(workingSize);
    await expectAccessibility('generation-recovery-italian');
    await study.settings({ appearance: Appearance.DARK, language: Language.ENGLISH });
    await page.reload();
    const retry = study.generate(
      study.agents.flashcards,
      {
        input: { prompt: `Title: ${failedTitle}\nStudent instruction (data): ` },
        output: {
          kind: 'flashcards',
          cards: [{ front: 'Which division preserves chromosome number?', back: 'Mitosis. [1]' }]
        },
        hold: true
      },
      history
    );

    await page.getByRole('button', { name: copy.Retry, exact: true }).click();
    await retry.called;
    await expect(page.getByRole('button', { name: copy.Retry, exact: true })).toHaveCount(0);
    await expectScreenshot('retrying', {
      target: page.locator('aside.study-sidebar'),
      ready: () => expect(page.getByRole('status', { name: copy.AgentRunFlashcards })).toBeVisible()
    });
    expect(await itemSize(sidebar, failedTitle)).toEqual(workingSize);
    await expectAccessibility('generation-retrying');
    retry.release();
    await expect.poll(async () => (await study.snapshot(failed.id)).resultVersionId).not.toBeNull();
    await expect(page.getByRole('status', { name: copy.AgentRunFlashcards })).toHaveCount(0);
    const retryVersion = await study.published(failed.id);

    await page.goto(`/flashcards/${retryVersion.material_id}?project=${fixture.project.id}`);
    await expectScreenshot('retry-ready', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByText('Which division preserves chromosome number?', { exact: true })
        ).toBeVisible()
    });
    const stoppedTitle = 'Cell division extra practice';
    const stopping = study.generate(
      study.agents.flashcards,
      {
        input: { prompt: `Title: ${stoppedTitle}\nStudent instruction (data): ` },
        output: cards,
        hold: true
      },
      study.history(retryVersion, version)
    );
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
    stopping.release(false);
    await expect
      .poll(async () =>
        (await study.executions(stopped.id)).items.some((run) => run.status === 'cancelled')
      )
      .toBe(true);
    expect((await study.snapshot(stopped.id)).resultVersionId).toBeNull();
  }
);

test.browser.stable(
  'Long study notes prepare every section before final material',
  async ({ page, study, ai, expectScreenshot, expectAccessibility, expect }) => {
    const fixture = await study.seed(`${study.lecture}\n\n`.repeat(180));
    const title = 'Full lecture flashcards';
    const context = await study.contextInputs(fixture, title);
    const candidateContext = await study.contextInputs(fixture, title, 'candidate');

    const maps = context.maps.map((call) =>
      ai.next(study.agents.studyNotes, { ...call, hold: true })
    );
    const reduction = ai.next(study.agents.studyNotes, { ...context.reduce, hold: true });

    for (const call of candidateContext.maps) ai.next(study.agents.studyNotes, call);

    ai.next(study.agents.studyNotes, candidateContext.reduce);

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
    const final = study.generate(study.agents.flashcards, {
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

    await expect(page.getByRole('status', { name: copy.AgentActivityPreparing })).toBeVisible();
    await expectScreenshot('preparing-section', {
      target: sidebar,
      ready: () =>
        expect(page.getByRole('status', { name: copy.AgentActivityPreparing })).toBeVisible()
    });
    const preparingSize = await itemSize(sidebar, title);

    maps[0]!.release();
    await maps[1]!.called;
    await expectScreenshot('next-section', {
      target: sidebar,
      ready: () =>
        expect(page.getByRole('status', { name: copy.AgentActivityPreparing })).toBeVisible()
    });
    maps[1]!.release();
    await reduction.called;
    await expectScreenshot('combining-context', {
      target: sidebar,
      ready: () =>
        expect(page.getByRole('status', { name: copy.AgentActivityCompacting })).toBeVisible()
    });
    expect(await itemSize(sidebar, title)).toEqual(preparingSize);
    reduction.release();
    await final.called;
    await expectScreenshot('final-generation', {
      target: sidebar,
      ready: () => expect(page.getByRole('status', { name: copy.AgentRunFlashcards })).toBeVisible()
    });
    expect(await itemSize(sidebar, title)).toEqual(preparingSize);
    await expectAccessibility('generation-current-phase');
    await expect(sidebar.getByText('Step 1', { exact: true })).toHaveCount(0);
    await page.getByRole('status', { name: copy.AgentRunFlashcards }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).click();
    const details = page.getByRole('dialog', { name: copy.AgentActivityDetails });

    await expectScreenshot('preparation-details', {
      target: details,
      ready: () =>
        expect(
          details.getByRole('button', {
            name: `${copy.AgentRunFlashcards} ${copy['workspace.state.running']}`,
            exact: true
          })
        ).toBeVisible()
    });
    await details.getByRole('button', { name: copy.Close }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await study.settings({ language: Language.ITALIAN });
    await page.reload();
    const italian = catalogs.italian;

    await expectScreenshot('italian-narrow', {
      target: 'viewport',
      ready: () =>
        expect(page.getByRole('status', { name: italian.AgentRunFlashcards })).toBeVisible()
    });
    expect(await itemSize(sidebar, title)).toEqual(preparingSize);
    await expectAccessibility('generation-italian-narrow');
    await expect(sidebar.getByText(italian.AgentActivityStepComplete, { exact: true })).toHaveCount(
      0
    );
    await page.setViewportSize({ width: 820, height: 540 });
    await expectScreenshot('italian-compact', {
      target: 'viewport',
      ready: () =>
        expect(
          page.getByRole('button', {
            name: italian.PracticeGenerationStop.replace('{title}', title)
          })
        ).toBeVisible()
    });
    expect(await itemSize(sidebar, title)).toEqual(preparingSize);
    await expectAccessibility('generation-italian-compact');
    await page.setViewportSize({ width: 1280, height: 900 });
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

test.browser.stable(
  'Quiz generation uses the selected notes and saved question settings',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const fixture = await study.seed();

    await study.quizPreferences({
      ...defaultQuizSettings,
      questionCount: 2,
      choiceCount: 3,
      questionKind: 'open',
      difficulty: 'balanced'
    });
    const generated = study.generate(study.agents.quiz, {
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
      ready: () => expect(page.getByRole('status', { name: copy.AgentRunQuiz })).toBeVisible()
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

type NoveltyScenario = 'exact repair' | 'semantic repair' | 'exhausted repair' | 'invalid review';

type NoveltyJourney = Pick<
  test.browser.Context,
  'page' | 'study' | 'expectScreenshot' | 'expectAccessibility' | 'expect'
>;

function noveltyOutput(kind: 'quiz' | 'flashcards', prompt: string) {
  return kind === 'quiz'
    ? {
        title: 'Cell division checkpoint',
        content: {
          kind: 'quiz' as const,
          questions: [
            {
              kind: 'open' as const,
              prompt,
              referenceAnswer: prompt.includes('molecule') ? 'DNA.' : 'Two daughter cells.',
              explanation: 'Mitosis preserves chromosome number. [1]'
            }
          ]
        }
      }
    : {
        kind: 'flashcards' as const,
        cards: [
          {
            front: prompt,
            back: prompt.includes('molecule')
              ? 'DNA is copied before cell division. [1]'
              : 'Mitosis produces two daughter cells. [1]'
          }
        ]
      };
}

function noveltyReview(scenario: NoveltyScenario) {
  return scenario === 'invalid review'
    ? { duplicates: [{ index: 1, reason: 'history_duplicate' as const }] }
    : scenario === 'semantic repair'
      ? {
          duplicates: [{ index: 0, reason: 'history_duplicate' as const }]
        }
      : { duplicates: [] };
}

async function noveltyJourney(
  { page, study, expectScreenshot, expectAccessibility, expect }: NoveltyJourney,
  kind: 'quiz' | 'flashcards',
  scenario: NoveltyScenario
) {
  const fixture = await study.seed();
  const agent = kind === 'quiz' ? study.agents.quiz : study.agents.flashcards;
  const output = (prompt: string) => noveltyOutput(kind, prompt);
  const priorTitle = 'Prior cell division practice';
  const priorPrompt = 'What does mitosis produce?';

  study.generate(agent, {
    input: { prompt: `Title: ${priorTitle}\nStudent instruction (data): ` },
    output: output(priorPrompt)
  });
  const prior = await study.request({
    title: priorTitle,
    kind,
    autoTitle: kind === 'quiz',
    projectId: fixture.project.id,
    inputs: [fixture.input]
  });

  await expect.poll(async () => (await study.snapshot(prior.id)).resultVersionId).not.toBeNull();
  const history = study.history(await study.published(prior.id));
  const title = `Cell division ${scenario}`;
  const duplicate = scenario === 'exact repair' || scenario === 'exhausted repair';
  const freshPrompt = 'Which molecule is copied before cell division?';
  const candidate = output(
    duplicate ? priorPrompt : 'How many daughter cells result from mitosis?'
  );
  const review = noveltyReview(scenario);
  const repairable = scenario !== 'invalid review';
  const controlled = study.novelty(
    agent,
    {
      input: { prompt: `Title: ${title}\nStudent instruction (data): ` },
      output: candidate,
      review,
      ...(repairable
        ? { repair: output(scenario === 'exhausted repair' ? priorPrompt : freshPrompt) }
        : {})
    },
    history
  );
  const request = await study.request({
    title,
    kind,
    autoTitle: kind === 'quiz',
    projectId: fixture.project.id,
    inputs: [fixture.input]
  });

  await controlled.firstReview.called;
  await page.goto(`/practice?project=${fixture.project.id}`);
  await page.getByText(title, { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: copy.AgentActivityDetails }).click();
  const details = page.getByRole('dialog', { name: copy.AgentActivityDetails });

  const activeReview = details
    .getByRole('button', {
      name: `${copy.AgentRunNovelty} ${copy['workspace.state.running']}`,
      exact: true
    })
    .last();

  await expectScreenshot('review-inspector', {
    target: details,
    ready: async () => {
      await expect(activeReview).toBeVisible();
      await activeReview.scrollIntoViewIfNeeded();
    }
  });

  if (repairable) {
    controlled.firstReview.release();
    await controlled.repair!.called;
    const activeRepair = details.getByRole('button', {
      name: `${kind === 'quiz' ? copy.AgentRunQuiz : copy.AgentRunFlashcards} ${copy['workspace.state.running']}`,
      exact: true
    });

    await expectScreenshot('repair-inspector', {
      target: details,
      ready: async () => {
        await expect(activeRepair).toBeVisible();
        await activeRepair.scrollIntoViewIfNeeded();
      }
    });
    controlled.repair!.release();
    await controlled.secondReview!.called;
    controlled.secondReview!.release();
  } else controlled.firstReview.release();

  return noveltyOutcome(
    { page, study, expectScreenshot, expectAccessibility, expect },
    {
      scenario,
      kind,
      requestId: request.id,
      projectId: fixture.project.id,
      details,
      freshPrompt,
      priorPrompt
    }
  );
}

async function noveltyOutcome(
  { page, study, expectScreenshot, expectAccessibility, expect }: NoveltyJourney,
  {
    scenario,
    kind,
    requestId,
    projectId,
    details,
    freshPrompt,
    priorPrompt
  }: {
    scenario: NoveltyScenario;
    kind: 'quiz' | 'flashcards';
    requestId: string;
    projectId: ProjectId;
    details: Locator;
    freshPrompt: string;
    priorPrompt: string;
  }
) {
  if (scenario === 'exhausted repair' || scenario === 'invalid review') {
    const error = scenario === 'exhausted repair' ? 'not_enough' : 'invalid_input';

    await expect.poll(async () => (await study.snapshot(requestId)).errorKind).toBe(error);
    await expectScreenshot('failed-inspector', {
      target: details,
      ready: () =>
        expect(
          details.getByText(copy.AgentActivityStepFailed, { exact: true }).first()
        ).toBeVisible()
    });
    expect((await study.snapshot(requestId)).resultVersionId).toBeNull();
    await expectAccessibility('novelty-failure-inspector');
  } else {
    await expect.poll(async () => (await study.snapshot(requestId)).resultVersionId).not.toBeNull();
    const version = await study.published(requestId);

    await expect(details).toHaveCount(0);
    await page.goto(
      `${kind === 'quiz' ? '/practice' : '/flashcards'}/${version.material_id}?project=${projectId}`
    );
    await expectScreenshot('repaired-material', {
      target: 'viewport',
      ready: () =>
        kind === 'quiz'
          ? expect(
              page.getByRole('button', { name: copy.PracticeStartQuiz, exact: true })
            ).toBeVisible()
          : expect(page.getByText(freshPrompt, { exact: true })).toBeVisible()
    });
    const prompts =
      version.content.kind === 'quiz'
        ? version.content.questions.map((question) => question.prompt)
        : version.content.cards.map((card) => card.front);

    expect(prompts).toContain(freshPrompt);
    expect(prompts).not.toContain(priorPrompt);
    await expectAccessibility('novelty-repaired-material');

    return reopenPublishedInspector({ expect }, page, kind);
  }

  return details;
}

async function reopenPublishedInspector(
  { expect }: Pick<test.browser.Context, 'expect'>,
  page: Page,
  kind: 'quiz' | 'flashcards'
) {
  await page.getByRole('button', { name: copy.Settings, exact: true }).click();
  const settings = page.getByRole('dialog', { name: copy.Settings });

  await settings.getByRole('button', { name: copy.AiActivityTitle, exact: true }).click();
  const history = settings
    .getByRole('button')
    .filter({ hasText: copy['workspace.task.material-generation'] });
  const inspector = page.getByRole('dialog', { name: copy.AgentActivityDetails });
  const label = kind === 'quiz' ? copy.AgentRunQuiz : copy.AgentRunFlashcards;

  await expect(history).toHaveCount(2);

  for (const item of await history.all()) {
    await item.click();
    const completed = inspector.getByRole('button', {
      name: `${label} ${copy.AgentActivityStepComplete}`,
      exact: true
    });

    await expect(completed.first()).toBeVisible();

    if ((await completed.count()) === 2) {
      await completed.last().scrollIntoViewIfNeeded();

      return inspector;
    }

    await inspector.getByRole('button', { name: copy.Close }).click();
  }

  throw new Error('Published repaired generation is missing from activity history');
}

test.browser.stable(
  'Quiz novelty exact repair',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const target = await noveltyJourney(
      { page, study, expectScreenshot, expectAccessibility, expect },
      'quiz',
      'exact repair'
    );

    await expectScreenshot('outcome', { target, ready: () => expect(target).toBeVisible() });
  }
);

test.browser.stable(
  'Quiz novelty semantic repair',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const target = await noveltyJourney(
      { page, study, expectScreenshot, expectAccessibility, expect },
      'quiz',
      'semantic repair'
    );

    await expectScreenshot('outcome', { target, ready: () => expect(target).toBeVisible() });
  }
);

test.browser.stable(
  'Quiz novelty exhausted repair',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const target = await noveltyJourney(
      { page, study, expectScreenshot, expectAccessibility, expect },
      'quiz',
      'exhausted repair'
    );

    await expectScreenshot('outcome', { target, ready: () => expect(target).toBeVisible() });
  }
);

test.browser.stable(
  'Quiz novelty invalid review',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const target = await noveltyJourney(
      { page, study, expectScreenshot, expectAccessibility, expect },
      'quiz',
      'invalid review'
    );

    await expectScreenshot('outcome', { target, ready: () => expect(target).toBeVisible() });
  }
);

test.browser.stable(
  'Flashcards novelty exact repair',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const target = await noveltyJourney(
      { page, study, expectScreenshot, expectAccessibility, expect },
      'flashcards',
      'exact repair'
    );

    await expectScreenshot('outcome', { target, ready: () => expect(target).toBeVisible() });
  }
);

test.browser.stable(
  'Flashcards novelty semantic repair',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const target = await noveltyJourney(
      { page, study, expectScreenshot, expectAccessibility, expect },
      'flashcards',
      'semantic repair'
    );

    await expectScreenshot('outcome', { target, ready: () => expect(target).toBeVisible() });
  }
);

test.browser.stable(
  'Flashcards novelty exhausted repair',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const target = await noveltyJourney(
      { page, study, expectScreenshot, expectAccessibility, expect },
      'flashcards',
      'exhausted repair'
    );

    await expectScreenshot('outcome', { target, ready: () => expect(target).toBeVisible() });
  }
);

test.browser.stable(
  'Flashcards novelty invalid review',
  async ({ page, study, expectScreenshot, expectAccessibility, expect }) => {
    const target = await noveltyJourney(
      { page, study, expectScreenshot, expectAccessibility, expect },
      'flashcards',
      'invalid review'
    );

    await expectScreenshot('outcome', { target, ready: () => expect(target).toBeVisible() });
  }
);
