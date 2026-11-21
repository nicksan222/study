import { gradeInputSchema, gradeOutputSchema } from '@study/contracts';
import { catalogs, countText, text } from '@study/localization';
import { test } from '@study/testing';

const copy = catalogs.english;

test.browser.use({
  microphoneEnabled: true,
  video: 'on',
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${Bun.fileURLToPath(new URL('../../../../tooling/testing/fixtures/voice/it_it_0228.wav', import.meta.url))}`
    ]
  }
});

async function openNotebook(
  { page, rpc, expect }: Pick<test.browser.Context, 'page' | 'rpc' | 'expect'>,
  content: string
) {
  const note = await rpc.runPromise(
    rpc.client['notes.createUntitledNote']({ initialMessage: { text: content, sourceIds: [] } })
  );

  await page.goto(`/notes/${note.id}`);
  const body = page.getByRole('textbox', { name: copy.NotePageEditor, exact: true });

  await expect(body).toHaveText(content);
  await body.focus();
  await page.keyboard.press('Control+End');

  return body;
}

function persistedNote(page: test.browser.Context['page']) {
  return page.getByRole('status').filter({ hasText: new RegExp(`^${copy.NoteAutosaved}$`) });
}

test.browser.stable(
  'Dictation preserves a note through recording failure retry and cancellation',
  async ({ page, rpc, microphone, expect, expectScreenshot, selectEditorText }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    const original = 'Before the dictated words. After the dictated words.';

    const composer = await openNotebook({ page, rpc, expect }, original);

    await expect(persistedNote(page)).toBeVisible();
    await selectEditorText(composer, 'the dictated words');
    const recording = await microphone.start(page, {
      holdPermission: true,
      segments: { failure: { error: 'transient' } }
    });
    const { failure } = recording.segments;

    await expect(page.getByRole('status', { name: copy.VoiceStarting, exact: true })).toBeVisible();
    await expectScreenshot('opening-microphone', {
      target: 'viewport',
      ready: () => expect(composer).toHaveText(original)
    });
    await recording.allow();
    const controls = page.getByRole('group', { name: copy.VoiceTitle, exact: true });

    await expect(controls.getByRole('button', { name: copy.VoiceStop, exact: true })).toBeEnabled();
    await expectScreenshot('recording', {
      target: 'viewport',
      ready: () => expect(composer).toHaveText(original)
    });
    await recording.stop();
    const input = await failure.requested;

    expect(input.samples.length).toBeGreaterThan(0);
    expect(input.samples.every(Number.isFinite)).toBe(true);
    expect(input.filterSilence).toBe(true);
    await expect(
      page.getByRole('status', { name: copy.VoiceTranscribing, exact: true })
    ).toBeVisible();
    await expect(composer).toHaveText(original);
    await expectScreenshot('transcribing', {
      target: 'viewport',
      ready: () => expect(composer).toHaveText(original)
    });
    await failure.deliver();
    await expect(page.getByRole('alert')).toContainText(copy.VoiceTranscriptionFailed);
    await expect(composer).toHaveText(original);
    const recovery = page.getByRole('button', { name: copy.VoiceRecoveryOptions, exact: true });

    await expectScreenshot('transcription-error', {
      target: 'viewport',
      ready: () => expect(recovery).toBeEnabled()
    });
    await recovery.click();
    const options = page.getByRole('dialog', { name: copy.VoiceTranscriptionFailedTitle });
    const retry = options.getByRole('button', { name: copy.Retry, exact: true });

    await expectScreenshot('transcription-recovery-options', {
      target: options,
      ready: () => expect(retry).toBeEnabled()
    });
    const recovered = recording.expectSegment('spoken field observation');

    await retry.click();
    const retried = await recovered.requested;

    expect(retried.samples).toEqual(input.samples);
    await recovered.deliver();
    const changed = 'Before spoken field observation. After the dictated words.';

    await expect(composer).toHaveText(changed);
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeFocused();
    await expectScreenshot('transcript-inserted', {
      target: 'viewport',
      ready: () =>
        expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled()
    });
    await microphone.start(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled();
    await expect(composer).toHaveText(changed);
    const cancelled = await microphone.start(page, {
      segments: { late: 'This late result must never enter the draft.' }
    });
    const { late } = cancelled.segments;

    await cancelled.stop();
    await late.requested;
    await cancelled.cancel();
    await late.aborted;
    await late.deliver();
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled();
    await expect(composer).toHaveText(changed);
    await expect(persistedNote(page)).toBeVisible();
    await page.reload();
    await expect(composer).toHaveText(changed);

    const richEditor = await openNotebook(
      { page, rpc, expect },
      'Keep the complete survey evidence'
    );
    const literal = '1. January is the deadline\n# Title\n---';

    await expect(persistedNote(page)).toBeVisible();
    await selectEditorText(richEditor, 'Keep the complete survey evidence');
    const rich = await microphone.start(page, { segments: { literal } });

    await rich.stop();
    await rich.segments.literal.requested;
    await expect(richEditor).toHaveText('Keep the complete survey evidence');
    await rich.segments.literal.deliver();
    await expect(richEditor).toHaveText(literal.replaceAll('\n', ''));
    await expect(richEditor.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(2);
    await expect(richEditor.locator('ol, ul, h1, h2, hr')).toHaveCount(0);
    await expect(persistedNote(page)).toBeVisible();
    await page.reload();
    await expect(richEditor).toHaveText(literal.replaceAll('\n', ''));
    await expect(richEditor.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(2);
    await expect(richEditor.locator('ol, ul, h1, h2, hr')).toHaveCount(0);
  }
);

test.browser.stable(
  'Voice setup requires installation consent and persists bilingual settings',
  async ({ page, rpc, microphone, expect, expectScreenshot }) => {
    const catalog = await rpc.runPromise(rpc.client['voice.status']({}));
    const model = catalog.models.find(({ id }) => id === catalog.modelId);

    if (!model) throw new Error('Voice status must include the active model in its catalog');

    const modelLabel = text('english', 'VoiceActiveModel', { model: model.name });

    await page.setViewportSize({ width: 1280, height: 900 });
    const draft = 'A private draft stays intact while voice is configured.';
    const composer = await openNotebook({ page, rpc, expect }, draft);

    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    const setup = page.getByRole('dialog', { name: copy.VoiceSetupTitle });

    await expect(setup).toBeVisible();
    await expect(setup.getByText(modelLabel, { exact: true })).toBeVisible();
    expect(microphone.model.downloads).toBe(0);
    await expectScreenshot('download-consent', {
      target: setup,
      ready: () => expect(setup.getByRole('button', { name: copy.VoiceDownload })).toBeEnabled()
    });
    await setup.getByRole('button', { name: copy.Close, exact: true }).last().click();
    await expect(setup).toBeHidden();
    expect(microphone.model.downloads).toBe(0);
    await expect(composer).toHaveText(draft);
    await page.getByRole('button', { name: copy.VoiceStart, exact: true }).click();
    const held = microphone.model.holdDownload();

    await setup.getByRole('button', { name: copy.VoiceDownload }).click();
    await held.requested;
    await expect(setup.getByRole('button', { name: copy.VoiceCancelDownload })).toBeEnabled();
    await expectScreenshot('downloading', {
      target: setup,
      ready: () => expect(setup.getByRole('progressbar')).toBeVisible()
    });
    await setup.getByRole('button', { name: copy.VoiceCancelDownload }).click();
    await held.aborted;
    await expect(setup.getByRole('button', { name: copy.VoiceDownload })).toBeEnabled();
    await setup.getByRole('button', { name: copy.VoiceDownload }).click();
    await expect(setup.getByText(copy.VoiceModelReady, { exact: true })).toBeVisible();
    await setup.getByRole('button', { name: copy.Close, exact: true }).last().click();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    const settings = page.getByRole('dialog', { name: copy.Settings });

    await settings.getByRole('button', { name: copy.VoiceTitle, exact: true }).click();
    await expect(settings.getByRole('heading', { name: model.name, exact: true })).toBeVisible();
    await expect(settings.getByText(copy.VoiceAutomatic, { exact: true })).toBeVisible();
    await expect(
      settings.getByText(countText('english', 'supportedLanguage', model.languages.length))
    ).toBeVisible();
    const length = settings.getByRole('combobox', { name: copy.VoiceChunkDuration });
    const denoise = settings.getByRole('switch', { name: copy.VoiceDenoise, exact: true });

    await length.click();
    await page.getByRole('option', { name: '10 seconds', exact: true }).click();
    await expect(length).toHaveText('10 seconds');
    await expect(denoise).not.toBeChecked();
    await denoise.click();
    await expect(denoise).toBeChecked();
    const filter = settings.getByRole('switch', { name: copy.VoiceFilterSilence, exact: true });

    await expect(filter).toBeChecked();
    await filter.click();
    await expect(filter).not.toBeChecked();
    await expect(filter).toBeEnabled();
    await expectScreenshot('voice-settings-english', {
      target: settings,
      ready: () => expect(filter).not.toBeChecked()
    });
    await page.reload();
    await page.getByRole('button', { name: copy.Settings, exact: true }).click();
    await settings.getByRole('button', { name: copy.VoiceTitle, exact: true }).click();
    await expect(filter).not.toBeChecked();
    await expect(length).toHaveText('10 seconds');
    await expect(denoise).toBeChecked();
    await settings.getByRole('button', { name: copy.GeneralSettingsTitle, exact: true }).click();
    await settings.getByRole('combobox', { name: copy.GeneralSettingsLanguage }).click();
    await page.getByRole('option', { name: copy.ItalianOwnName }).click();
    const italian = catalogs.italian;
    const localized = page.getByRole('dialog', { name: italian.Settings });

    await localized.getByRole('button', { name: italian.VoiceTitle, exact: true }).click();
    await page.setViewportSize({ width: 760, height: 900 });
    const localizedFilter = localized.getByRole('switch', {
      name: italian.VoiceFilterSilence,
      exact: true
    });

    await expect(localizedFilter).not.toBeChecked();
    await expect(localized.getByRole('heading', { name: model.name, exact: true })).toBeVisible();
    await expect(
      localized.getByText(countText('italian', 'supportedLanguage', model.languages.length))
    ).toBeVisible();
    await expect(localized.getByText(italian.VoiceAutomatic, { exact: true })).toBeVisible();
    await expectScreenshot('voice-settings-italian-compact', {
      target: 'viewport',
      ready: () => expect(localizedFilter).toBeInViewport({ ratio: 1 })
    });
    const removeDownload = localized.getByRole('button', { name: italian.VoiceRemove });

    await removeDownload.scrollIntoViewIfNeeded();
    await expectScreenshot('voice-settings-italian-download', {
      target: 'viewport',
      ready: () => expect(removeDownload).toBeInViewport({ ratio: 1 })
    });
    await removeDownload.press('Enter');
    await expect(localized.getByText(italian.VoiceModelMissing)).toBeVisible();
    const status = await rpc.runPromise(rpc.client['voice.status']({}));

    expect(status.state).toBe('missing');
  }
);

test.browser.stable(
  'Live dictation inserts each segment into the note while recording',
  async ({ page, rpc, microphone, expect, expectScreenshot }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    await rpc.runPromise(
      rpc.client['settings.saveVoiceSettings']({
        filterSilence: true,
        chunkSeconds: 10,
        denoise: true
      })
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    const draft = 'Field notes.';
    const firstText = 'The river rose overnight.';
    const secondText = 'The footbridge is still open.';
    const finalText = 'Check again tomorrow.';
    const firstDraft = `${draft} ${firstText}`;
    const secondDraft = `${firstDraft} ${secondText}`;
    const complete = `${secondDraft} ${finalText}`;
    const starting = page.getByRole('button', { name: copy.VoiceStart, exact: true });
    const controls = page.getByRole('group', { name: copy.VoiceTitle, exact: true });
    const stop = controls.getByRole('button', { name: copy.VoiceStop, exact: true });
    const elapsed = controls.locator('time');

    const composer = await openNotebook({ page, rpc, expect }, draft);

    await composer.press('End');
    const recording = await microphone.start(page, {
      segments: { first: firstText, second: secondText }
    });
    const { first, second } = recording.segments;
    const movingBar = controls
      .locator(
        '.voice-capture-waveform > span[style*="--voice-amplitude"]:not([style*="--voice-amplitude: 0;"])'
      )
      .first();

    await expect(movingBar).toBeVisible();
    await expect(elapsed).toHaveText('0:00');
    const firstChunk = await first.requested;

    expect(firstChunk.samples.length).toBeGreaterThan(0);
    expect(firstChunk.samples.length).toBeLessThanOrEqual(160_000);
    expect(firstChunk.denoise).toBe(true);
    await expectScreenshot('waiting-for-first-segment', {
      target: 'viewport',
      ready: async () => {
        await expect(stop).toBeEnabled();
        await expect(
          controls.getByRole('button', { name: copy.VoiceCancel, exact: true })
        ).toBeEnabled();
        await expect(composer).toHaveText(draft);
      }
    });
    await first.deliver();
    await recording.setElapsed(6);
    await expectScreenshot('first-segment-in-draft', {
      target: 'viewport',
      ready: async () => {
        await expect(stop).toBeEnabled();
        await expect(elapsed).toHaveText('0:06');
        await expect(composer).toHaveText(firstDraft);
      }
    });

    await second.deliver();
    await expectScreenshot('second-segment-in-draft', {
      target: 'viewport',
      ready: async () => {
        await expect(stop).toBeEnabled();
        await expect(composer).toHaveText(secondDraft);
      }
    });
    const final = recording.expectSegment(finalText);

    await recording.stop();
    const tail = await final.requested;

    expect(tail.samples.length).toBeGreaterThan(0);
    expect(tail.samples.length).toBeLessThan(firstChunk.samples.length);
    await recording.setElapsed(0);
    await expectScreenshot('waiting-for-final-segment', {
      target: 'viewport',
      ready: async () => {
        await expect(
          page.getByRole('status', { name: copy.VoiceTranscribing, exact: true })
        ).toBeVisible();
        await expect(composer).toHaveText(secondDraft);
      }
    });
    await final.deliver();
    await expectScreenshot('complete-transcript-in-draft', {
      target: 'viewport',
      ready: async () => {
        await expect(composer).toHaveText(complete);
        await expect(composer).toBeFocused();
        await expect(starting).toBeEnabled();
      }
    });

    await expect(persistedNote(page)).toBeVisible();
    await page.reload();

    await expectScreenshot('complete-transcript-in-saved-note', {
      target: composer,
      ready: () => expect(composer).toHaveText(complete)
    });
  }
);

test.browser.stable(
  'Leaving a notebook cancels transcription and keeps the delivered words',
  async ({ page, rpc, microphone, expect, expectScreenshot }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    await rpc.runPromise(
      rpc.client['settings.saveVoiceSettings']({ filterSilence: true, chunkSeconds: 10 })
    );
    const original = 'Keep this observation when I leave the notebook.';
    const composer = await openNotebook({ page, rpc, expect }, original);
    const noteUrl = page.url();
    const partialText = 'A live transcript arrives before stopping.';
    const delivered = `${original} ${partialText}`;
    const recording = await microphone.start(page, {
      segments: {
        first: partialText,
        pending: 'A cancelled result must never enter this draft.'
      }
    });
    const { first, pending } = recording.segments;
    const firstChunk = await first.requested;

    expect(firstChunk.samples.length).toBeGreaterThan(0);
    expect(firstChunk.samples.length).toBeLessThanOrEqual(160_000);
    await first.deliver();
    await expect(composer).toHaveText(delivered);
    await expect(persistedNote(page)).toBeVisible();
    await recording.stop();
    await pending.requested;
    await expectScreenshot('partial-transcript-before-cancel', {
      target: 'viewport',
      ready: async () => {
        await expect(
          page.getByRole('status', { name: copy.VoiceTranscribing, exact: true })
        ).toBeVisible();
        await expect(composer).toHaveText(delivered);
      }
    });
    await page.getByRole('link', { name: new RegExp(`^${copy.Notes}(?: \\d+)?$`) }).click();
    await pending.aborted;
    await pending.deliver();
    await expect(page.getByRole('textbox', { name: copy.NoteCompose })).toBeVisible();

    await page.goto(noteUrl);
    await expect(page.getByRole('button', { name: copy.VoiceStart, exact: true })).toBeEnabled();
    await expectScreenshot('notebook-reopened-after-cancelled-transcription', {
      target: 'viewport',
      ready: () => expect(composer).toHaveText(delivered)
    });
  }
);

test.browser.stable(
  'Changing note width preserves pending dictation',
  async ({ page, rpc, microphone, expect, expectScreenshot }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    const input = await openNotebook({ page, rpc, expect }, 'Field observation.');
    const recording = await microphone.start(page, {
      segments: { final: 'The water reached the marker.' }
    });

    await recording.stop();
    await recording.segments.final.requested;

    await rpc.runPromise(rpc.client['settings.saveAppearancePreferences']({ noteWidth: 'wide' }));
    await expect(page.locator('.workspace-desk')).toHaveAttribute('data-content-width', 'wide');
    await expect(page.getByRole('status', { name: copy.VoiceTranscribing })).toBeVisible();
    await recording.segments.final.deliver();

    await expectScreenshot('transcript-in-wide-notebook', {
      target: 'viewport',
      ready: () => expect(input).toHaveText('Field observation. The water reached the marker.')
    });
    await expect(persistedNote(page)).toBeVisible();
    await page.reload();
    await expect(input).toHaveText('Field observation. The water reached the marker.');
  }
);

test.browser.stable(
  'A recognition result completed after cancellation cannot change the note',
  async ({ page, rpc, microphone, expect, expectScreenshot }) => {
    await rpc.runPromise(rpc.client['voice.install']({}));
    const composer = await openNotebook({ page, rpc, expect }, 'Keep this draft.');

    const recording = await microphone.start(page, {
      segments: { late: { text: 'Never add this text.', completeAfterAbort: true } }
    });
    const { late } = recording.segments;

    await recording.stop();
    await late.requested;
    await recording.cancel();
    await late.aborted;
    await late.deliver();
    await late.settled;
    const replacement = await microphone.start(page, { segments: { final: 'Fresh speech.' } });

    await replacement.stop();
    await replacement.segments.final.deliver();
    await expectScreenshot('fresh-transcript-only', {
      target: 'viewport',
      ready: () => expect(composer).toHaveText('Keep this draft. Fresh speech.')
    });
  }
);

test.browser.describe('Practice dictation', () => {
  test.browser.use({ aiEnabled: true });

  test.browser.stable(
    'Open practice answers finish dictation before submission',
    async ({ page, rpc, study, ai, microphone, expect, expectScreenshot }) => {
      const fixture = await study.seed();

      await rpc.runPromise(rpc.client['voice.install']({}));
      const prompt = 'What does a eukaryotic cell contain?';
      const reference = 'A nucleus.';
      const finalAnswer = 'A eukaryotic cell contains a nucleus.';
      const material = await rpc.runPromise(
        rpc.client['materials.create']({
          title: 'Cell structure',
          content: {
            kind: 'quiz',
            questions: [
              {
                kind: 'open',
                prompt,
                referenceAnswer: reference,
                explanation: 'The nucleus contains the cell’s genetic material.'
              }
            ]
          }
        })
      );

      await page.setViewportSize({ width: 1100, height: 850 });
      await page.goto(`/practice/${material.id}`);
      await page.getByRole('button', { name: copy.PracticeStartQuiz }).click();
      const answer = page.getByRole('textbox', { name: copy.YourAnswer });
      const submit = page.getByRole('button', { name: copy.SubmitAnswer });

      await answer.fill('A eukaryotic cell');
      await expect(submit).toBeEnabled();
      await expectScreenshot('practice-answer-editor', {
        target: 'viewport',
        ready: () => expect(page.getByRole('button', { name: copy.VoiceStart })).toBeVisible()
      });

      const recording = await microphone.start(page, {
        segments: { final: 'contains a nucleus.' }
      });

      await expect(submit).toBeDisabled();
      await recording.setElapsed(6);
      await expectScreenshot('practice-answer-recording', {
        target: 'viewport',
        ready: async () => {
          await expect(page.getByRole('button', { name: copy.VoiceStop })).toBeEnabled();
          await expect(
            page.getByRole('group', { name: copy.VoiceTitle }).locator('time')
          ).toHaveText('0:06');
        }
      });
      await recording.stop();
      await recording.setElapsed(0);
      await recording.segments.final.requested;
      await answer.press('ControlOrMeta+Enter');
      await expect(answer).toHaveValue('A eukaryotic cell');
      await expect(submit).toBeDisabled();
      await expectScreenshot('practice-answer-transcribing', {
        target: 'viewport',
        ready: () =>
          expect(page.getByRole('status', { name: copy.VoiceTranscribing })).toBeVisible()
      });
      await recording.segments.final.deliver();
      await expect(answer).toHaveValue(finalAnswer);
      await expectScreenshot('practice-answer-ready', {
        target: 'viewport',
        ready: () => expect(submit).toBeEnabled()
      });

      const grading = ai.next(
        {
          id: 'learning-grade',
          input: gradeInputSchema,
          output: gradeOutputSchema,
          mode: 'object'
        },
        {
          input: { prompt: JSON.stringify({ question: prompt, reference, answer: finalAnswer }) },
          output: { verdict: 'correct', feedback: 'Correct.' }
        }
      );

      await submit.click();
      await grading.called;
      await page.goto(`/practice?project=${fixture.project.id}`);
      await page.getByRole('button', { name: copy.PracticeGenerate, exact: true }).click();
      const generation = page.getByRole('dialog', { name: copy.PracticeGenerate });

      await generation.getByRole('radio', { name: copy.Flashcards, exact: true }).click();
      await generation.getByText(copy.PracticeCustomize, { exact: true }).click();
      await generation
        .getByRole('textbox', { name: copy.PracticeGeneratePrompt })
        .scrollIntoViewIfNeeded();
      await expectScreenshot('flashcard-instructions', {
        target: generation,
        ready: () => expect(generation.getByRole('button', { name: copy.VoiceStart })).toBeEnabled()
      });
    }
  );
});
