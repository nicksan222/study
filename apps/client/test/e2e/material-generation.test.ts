import { StudyError } from '@study/contracts/errors';
import { catalogs } from '@study/localization';

import { expect, testE2e } from './harness/index.ts';

testE2e.use({ aiEnabled: true });

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
    await expectScreenshot('failed', {
      target: page.locator('aside.study-sidebar'),
      ready: () =>
        expect(page.getByRole('button', { name: copy.PracticeGenerate, exact: true })).toBeVisible()
    });
  }
);
