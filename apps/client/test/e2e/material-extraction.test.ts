import { Language, LlmProvider } from '@study/contracts';
import type { SourceId } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { hideExtractionTime } from './fixtures/material-formats.ts';

test.browser.use({
  video: process.env.E2E_REVIEW ? { mode: 'on', size: { width: 1440, height: 900 } } : 'off'
});

const scan = new URL(
  '../../../../tooling/scripts/seed/fixtures/files/mitosis/metaphase.png',
  import.meta.url
);

function extractionReader({
  page,
  expect,
  expectScreenshot,
  rpc,
  copy
}: Pick<test.browser.Context, 'page' | 'expect' | 'expectScreenshot' | 'rpc'> & {
  copy: (typeof catalogs)['english' | 'italian'];
}) {
  const reader = page.locator('[data-materials-reader]');
  const status = reader.getByRole('status').and(page.locator('[data-material-extraction-status]'));
  const toggle = reader.getByRole('button', { name: copy.UploadedMaterialsDetails, exact: true });
  const details = reader.getByRole('region', { name: copy.MaterialExtractionHeading, exact: true });
  const time = details.locator('time');

  async function check(state: string, label: string, capture?: { name: string; id: SourceId }) {
    await expect(status).toHaveAttribute('data-material-extraction-status', state, {
      timeout: state === 'failed' ? 15_000 : undefined
    });

    if ((await toggle.count()) && (await toggle.getAttribute('aria-pressed')) !== 'true')
      await toggle.click();

    const ready = async () => {
      await expect(status).toHaveText(label);
      await expect(details.getByText(copy.MaterialExtractionStatus, { exact: true })).toBeVisible();
      await expect(details.getByText(label, { exact: true })).toBeVisible();
    };

    await ready();

    if (!capture) return;

    const { client, runPromise } = rpc;
    const processing = await runPromise(client['sources.sourceProcessing']({ id: capture.id }));

    await expect(details.getByText(copy.MaterialExtractionUpdated, { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const runs = processing.requestId
          ? await runPromise(
              client['workflows.executions']({
                correlationId: processing.requestId,
                workflows: ['source-ingestion/v1'],
                limit: 1
              })
            )
          : undefined;
        const stamp = runs?.items[0]?.updatedAtMs ?? processing.requestedAtMs;

        return stamp == null
          ? false
          : (await time.getAttribute('datetime')) === new Date(Number(stamp)).toISOString();
      })
      .toBe(true);
    await expectScreenshot(capture.name, {
      target: 'viewport',
      style: hideExtractionTime(copy.MaterialExtractionHeading),
      ready
    });
  }

  return { reader, check, time };
}

test.browser.stable(
  'Materials show live extraction and preserve retained revisions',
  async ({ page, app, rpc, sourcePeer, expect, expectScreenshot }) => {
    const copy = catalogs.italian;
    const { reader, check } = extractionReader({ page, expect, expectScreenshot, rpc, copy });
    const { client, runPromise } = rpc;
    const settings = await runPromise(client['settings.appSettings']({}));

    await runPromise(
      client['settings.saveAppSettings']({ ...settings, language: Language.ITALIAN })
    );
    const project = await runPromise(client['projects.createProject']({ name: 'Microscopy' }));
    const first = sourcePeer.next('Chromosomes align.', { hold: true });

    await app.workers.stop();
    const source = await runPromise(
      client['sources.addLink']({
        name: 'Microscopy observations',
        projectId: project.id,
        url: sourcePeer.url
      })
    );
    const current = `/projects/${project.id}/sources/${source.id}?fromUploads=1`;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(current);
    await check('queued', copy.MaterialExtractionQueued, { name: 'queued', id: source.id });

    await app.workers.start();
    await first.called;
    await check('running', copy.MaterialExtractionRunning, { name: 'extracting', id: source.id });
    await page.reload();
    await check('running', copy.MaterialExtractionRunning);
    first.release();
    await check('complete', copy.MaterialExtractionComplete, { name: 'completed', id: source.id });

    const extraction = await runPromise(client['sources.currentExtraction']({ id: source.id }));

    if (!extraction) throw new Error('Completed source has no extraction');

    const unsupported = await runPromise(
      client['sources.createSource']({
        name: 'archive.bin',
        projectId: project.id,
        bytes: new Uint8Array([0, 255, 0, 255])
      })
    );
    const list = page.getByRole('navigation', { name: copy.UploadedMaterials });

    await list.getByRole('link', { name: unsupported.name, exact: false }).click();
    await check('unsupported', copy.SourceExtractionUnsupported, {
      name: 'unsupported',
      id: unsupported.id
    });
    await expect(reader.getByRole('button', { name: copy.UploadedMaterialsRetry })).toHaveCount(0);
    await page.goBack();
    await check('complete', copy.MaterialExtractionComplete);

    const failure = sourcePeer.next('Unavailable', { status: 503 });

    await runPromise(
      client['sources.requestSourceProcessing']({ id: source.id, expectedRevision: 1 })
    );
    await failure.called;
    await check('failed', copy.SourceExtractionFailed, { name: 'failed', id: source.id });
    await expect(reader.getByText(copy.MaterialExtractionRetained, { exact: true })).toBeVisible();

    const retry = sourcePeer.next('A second reading.', { hold: true });

    await reader.getByRole('button', { name: copy.UploadedMaterialsRetry, exact: true }).click();
    await retry.called;
    await check('running', copy.MaterialExtractionRunning);
    retry.release();
    await check('complete', copy.MaterialExtractionComplete, { name: 'recovered', id: source.id });
    await reader.getByRole('button', { name: copy.UploadedMaterialsText, exact: true }).click();
    await expect(reader.getByText('A second reading.', { exact: true })).toBeVisible();

    const pinned = `${current}&sourceRevision=${extraction.revision}&sourceSnapshot=${extraction.snapshotId}`;

    await page.goto(pinned);
    await expectScreenshot('retained-extraction', {
      target: 'viewport',
      ready: async () => {
        await expect(reader.getByText('Chromosomes align.', { exact: true })).toBeVisible();
        await expect(reader.getByText('A second reading.', { exact: true })).toHaveCount(0);
        await expect(reader.locator('[data-material-extraction-status]')).toHaveCount(0);
      }
    });
  }
);

test.browser.stable(
  'Materials show provider wait and cancelled extraction',
  async ({ page, rpc, expect, expectScreenshot }) => {
    const copy = catalogs.english;
    const { reader, check, time } = extractionReader({ page, expect, expectScreenshot, rpc, copy });
    const { client, runPromise } = rpc;
    const project = await runPromise(client['projects.createProject']({ name: 'Microscopy' }));
    const source = await runPromise(
      client['sources.createSource']({
        name: 'metaphase.png',
        projectId: project.id,
        bytes: await Bun.file(scan).bytes()
      })
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/projects/${project.id}/sources/${source.id}?fromUploads=1`);
    await check('waiting', copy.NoteWaitAuth, { name: 'provider-wait', id: source.id });

    const observations = await runPromise(
      client['sources.createSource']({
        name: 'observations.txt',
        projectId: project.id,
        bytes: new TextEncoder().encode('Compare the retained slides.')
      })
    );
    const library = page.getByRole('navigation', { name: copy.UploadedMaterials });

    await library.getByRole('link', { name: observations.name, exact: false }).press('Enter');
    await check('complete', copy.MaterialExtractionComplete);
    await library.getByRole('link', { name: source.name, exact: false }).press('Enter');
    await check('waiting', copy.NoteWaitAuth);
    const processing = await runPromise(client['sources.sourceProcessing']({ id: source.id }));

    if (!processing.requestId) throw new Error('Waiting scan has no processing request');

    const executions = await runPromise(
      client['workflows.executions']({
        correlationId: processing.requestId,
        workflows: ['source-ingestion/v1'],
        limit: 1
      })
    );
    const execution = executions.items[0];

    if (!execution) throw new Error('Waiting scan has no workflow execution');

    expect(execution.status).toBe('suspended');

    await runPromise(client['workflows.cancelExecution']({ id: execution.id, mode: 'safe' }));
    await check('cancelled', copy.MaterialExtractionCancelled);
    const cancelled = await runPromise(client['workflows.execution']({ id: execution.id }));

    await expect(time).toHaveAttribute(
      'datetime',
      new Date(Number(cancelled.updatedAtMs)).toISOString()
    );
    await expectScreenshot('cancelled', {
      style: hideExtractionTime(copy.MaterialExtractionHeading),
      target: 'viewport',
      ready: async () => {
        await expect(reader.locator('[data-material-extraction-status]')).toHaveText(
          copy.MaterialExtractionCancelled
        );
      }
    });
    await page.reload();
    await check('cancelled', copy.MaterialExtractionCancelled);
    const settings = await runPromise(client['settings.appSettings']({}));
    const italian = catalogs.italian;

    await runPromise(
      client['settings.saveAppSettings']({ ...settings, language: Language.ITALIAN })
    );
    await page.reload();
    await reader
      .getByRole('button', { name: italian.UploadedMaterialsDetails, exact: true })
      .press('Enter');
    const localized = reader.getByRole('region', {
      name: italian.MaterialExtractionHeading,
      exact: true
    });

    await expectScreenshot('cancelled-italian', {
      target: 'viewport',
      style: hideExtractionTime(italian.MaterialExtractionHeading),
      ready: async () => {
        await expect(reader.locator('[data-material-extraction-status]')).toHaveText(
          italian.MaterialExtractionCancelled
        );
        await expect(
          localized.getByText(italian.MaterialExtractionStatus, { exact: true })
        ).toBeVisible();
        await expect(
          localized.getByText(italian.MaterialExtractionUpdated, { exact: true })
        ).toBeVisible();
        await expect(localized.locator('time')).toHaveAttribute(
          'datetime',
          new Date(Number(cancelled.updatedAtMs)).toISOString()
        );
      }
    });
  }
);

test.browser.describe('Image extraction with a controlled Responses API peer', () => {
  const model = 'gpt-6.1-sol';
  const requested = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<string>();

  test.browser.use({
    chatGpt: {
      chatGptReleases: [
        {
          model,
          async text() {
            requested.resolve();

            return reply.promise;
          }
        }
      ]
    }
  });

  test.browser.stable(
    'Materials show the real image extraction phase',
    async ({ page, rpc, selectChatGptRelease, expect, expectScreenshot }) => {
      const copy = catalogs.italian;
      const { reader, check, time } = extractionReader({
        page,
        expect,
        expectScreenshot,
        rpc,
        copy
      });
      const { client, runPromise } = rpc;
      const settings = await runPromise(client['settings.appSettings']({}));
      const llm = await runPromise(client['settings.llmSettings']({}));

      await runPromise(
        client['settings.saveAppSettings']({ ...settings, language: Language.ITALIAN })
      );
      await runPromise(
        client['settings.saveLlmSettings']({
          ...llm,
          medium: { provider: LlmProvider.CHAT_GPT, model }
        })
      );
      await selectChatGptRelease(model);
      const catalog = await runPromise(client['settings.modelCatalog']({}));

      expect(catalog.recommendations.length).toBeGreaterThan(0);
      expect(await runPromise(client['settings.modelUpdates']({}))).toEqual([]);
      const project = await runPromise(client['projects.createProject']({ name: 'Microscopia' }));
      const transcription = 'I cromosomi si allineano al centro della cellula.';
      const source = await runPromise(
        client['sources.createSource']({
          name: 'metaphase.png',
          projectId: project.id,
          bytes: await Bun.file(scan).bytes()
        })
      );

      try {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/projects/${project.id}/sources/${source.id}?fromUploads=1`);
        await requested.promise;
        await check('running', copy.MaterialExtractionRunning);
        const processing = await runPromise(client['sources.sourceProcessing']({ id: source.id }));

        if (!processing.requestId) throw new Error('Image has no extraction request');

        const executions = await runPromise(
          client['workflows.executions']({
            correlationId: processing.requestId,
            workflows: ['source-ingestion/v1'],
            limit: 1
          })
        );
        const execution = executions.items[0];

        if (!execution) throw new Error('Image has no extraction workflow');

        const progress = await runPromise(
          client['workflows.agentProgress']({ executionId: execution.id })
        );

        expect(progress).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              phase: 'generating',
              status: 'running',
              executionStatus: 'running'
            })
          ])
        );
        const details = reader.getByRole('region', {
          name: copy.MaterialExtractionHeading,
          exact: true
        });

        await expectScreenshot('generating', {
          target: 'viewport',
          style: hideExtractionTime(copy.MaterialExtractionHeading),
          ready: async () => {
            await expect(page.getByText(copy.ModelUpdateAvailable, { exact: true })).toHaveCount(0);
            await expect(
              details.getByText(copy.MaterialExtractionStage, { exact: true })
            ).toBeVisible();
            await expect(
              details.getByText(copy.MaterialExtractionModelRunning, { exact: true })
            ).toBeVisible();
            await expect(time).toHaveAttribute(
              'datetime',
              new Date(Number(execution.updatedAtMs)).toISOString()
            );
          }
        });
      } finally {
        reply.resolve(
          JSON.stringify({
            pages: [{ page: 1, blocks: [{ kind: 'paragraph', text: transcription }] }]
          })
        );
      }

      await check('complete', copy.MaterialExtractionComplete);
      await expect(reader.getByText(copy.MaterialExtractionStage, { exact: true })).toHaveCount(0);
      await reader.getByRole('button', { name: copy.UploadedMaterialsText, exact: true }).click();
      await expect(reader.getByText(transcription, { exact: true })).toBeVisible();
    }
  );
});
