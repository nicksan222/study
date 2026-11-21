import {
  StudyError,
  materialDetailSchema,
  materialVersionDetailSchema,
  summarySchema,
  projectSchema,
  noteSchema,
  studyNotesInstructionLimit,
  defaultQuizSettings
} from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Option, Schema } from 'effect';

import type * as __MockType0 from '#client/features/material-library/test/support.tsx';
import type * as Host from '#client/lib/host.ts';
import { readyVoiceStatus } from '#client/test/page-values.ts';

let learningVersion: typeof __MockType0.learningVersion;

let materialRpc: typeof __MockType0.materialRpc;

let mountLibraryRoute: typeof __MockType0.mountLibraryRoute;

let readiness: ReturnType<typeof createMockState>['readiness'];

let cancelCapture: () => void;

const en = catalogs.english;

function rpcFixture({ vi }: Pick<test.unit.Context, 'vi'>, linked = true) {
  const rpc = materialRpc({ vi });

  rpc['projects.projects'].mockReturnValue(
    Effect.succeed({
      items: [
        Schema.decodeUnknownSync(projectSchema)({
          id: 1n,
          name: 'Mathematics',
          examOn: null,
          createdAt: 1n,
          updatedAt: 1n
        })
      ],
      next: null
    })
  );
  rpc['projects.findProject'].mockImplementation(() =>
    rpc['projects.projects']({ limit: 100 }).pipe(
      Effect.map((page) => Option.fromNullishOr(page.items[0]))
    )
  );
  const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
    ...learningVersion(102n),
    inputs: linked
      ? [
          { kind: 'page', versionId: 8n },
          { kind: 'source', sourceId: 7n, revision: 1n, snapshotId: 9n }
        ]
      : [],
    kind: 'quiz',
    content: {
      kind: 'quiz',
      questions: [
        {
          id: 3n,
          position: 0n,
          kind: 'open',
          prompt: 'Explain prime numbers',
          explanation: 'Prime numbers have two divisors',
          referenceAnswer: 'Two divisors'
        }
      ]
    }
  });
  const material = Schema.decodeUnknownSync(materialDetailSchema)({
    id: 41n,
    kind: 'quiz',
    title: 'Number theory',
    projectIds: [1n],
    created_at: 1n,
    updated_at: 1n,
    archived_at: null,
    version,
    latestPublishedVersion: version,
    latestDraftVersion: null
  });

  rpc['pages.pages'].mockReturnValue(
    Effect.succeed({
      items: [
        Schema.decodeUnknownSync(summarySchema)({
          id: 8n,
          projectIds: [1n],
          title: 'Prime numbers notes',
          description: null,
          createdAt: 1n,
          updatedAt: 1n,
          archivedAt: null,
          headVersionId: 8n
        })
      ],
      nextCursor: null
    })
  );
  rpc['materials.material'].mockReturnValue(Effect.succeed(material));
  rpc['materials.materialVersion'].mockReturnValue(
    Effect.succeed({
      ...version,
      id: Schema.decodeUnknownSync(materialVersionDetailSchema)({ ...version, id: 200n }).id,
      material_id: Schema.decodeUnknownSync(materialDetailSchema)({ ...material, id: 42n }).id
    })
  );

  return {
    ...rpc,
    'notes.notes': () => Effect.succeed({ items: [], next: null }),
    'sources.sources': vi
      .fn<StudyClient['sources.sources']>()
      .mockReturnValue(Effect.succeed({ items: [], next: null })),
    'settings.quizSettings': vi
      .fn<StudyClient['settings.quizSettings']>()
      .mockReturnValue(
        Effect.succeed({ ...defaultQuizSettings, questionCount: 3, choiceCount: 2 })
      ),
    'materials.requestMaterialGeneration': vi
      .fn<StudyClient['materials.requestMaterialGeneration']>()
      .mockImplementation((input) =>
        Effect.succeed({ id: 'generation-1', ...input, inputs: [...input.inputs] })
      ),
    'materials.materialGeneration': vi
      .fn<StudyClient['materials.materialGeneration']>()
      .mockImplementation(() =>
        Effect.succeed({
          id: 'generation-1',
          projectId: material.projectIds[0],
          title: 'Number theory',
          kind: 'quiz',
          inputs: version.inputs,
          cancelled: false,
          errorKind: null,
          resultVersionId: Schema.decodeUnknownSync(materialVersionDetailSchema)({
            ...version,
            id: 200n
          }).id
        })
      )
  };
}

function createMockState() {
  return {
    readiness: (() => ({ state: 'ready' }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState();

  readiness = __mockState.readiness;
  cancelCapture = mock.fn();

  mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => readiness.state }));
  mock('#client/lib/host.ts', async (load) => ({
    ...(await load<typeof Host>()),
    microphoneAvailable: () => true,
    captureMicrophone: async () => ({ stop: async () => [0.4], cancel: cancelCapture })
  }));
  mock('#client/features/agent-progress', () => ({
    AgentProgress: () => <div>Leaked generation activity</div>
  }));
  const __mockModule0 = await import('#client/features/material-library/test/support.tsx');

  learningVersion = __mockModule0.learningVersion;
  materialRpc = __mockModule0.materialRpc;
  mountLibraryRoute = __mockModule0.mountLibraryRoute;
});

test.unit.stable(
  'closing Customize cancels dictation and retains the practice prompt',
  async ({ userEvent, waitFor, expect, screen, within, vi, render, rpcHandlersTransport }) => {
    const user = userEvent.setup();
    const rpc = {
      ...rpcFixture({ vi }),
      'voice.status': () => Effect.succeed(readyVoiceStatus),
      'settings.voiceSettings': () => Effect.succeed({ filterSilence: true })
    };

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = within(await screen.findByRole('dialog', { name: en.PracticeGenerate }));
    const customize = dialog.getByText(en.PracticeCustomize);

    await user.click(customize);
    await user.type(dialog.getByRole('textbox', { name: en.PracticeGeneratePrompt }), 'My prompt');
    await user.click(await dialog.findByRole('button', { name: en.VoiceStart }));
    await dialog.findByRole('button', { name: en.VoiceStop });
    await user.click(customize);
    await waitFor(() => expect(cancelCapture).toHaveBeenCalledOnce());
    await user.click(customize);
    expect(dialog.getByRole('textbox', { name: en.PracticeGeneratePrompt })).toHaveValue(
      'My prompt'
    );
    expect(dialog.queryByRole('button', { name: en.VoiceStop })).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'retries generation only after the final dictation segment reaches its prompt',
  async ({ userEvent, waitFor, act, expect, screen, within, vi, render, rpcHandlersTransport }) => {
    const user = userEvent.setup();
    const recognition = Promise.withResolvers<{ text: string }>();
    const transcribe = vi.fn(() => Effect.promise(() => recognition.promise));
    const rpc = {
      ...rpcFixture({ vi }),
      'voice.status': () => Effect.succeed(readyVoiceStatus),
      'voice.transcribe': transcribe,
      'settings.voiceSettings': () => Effect.succeed({ filterSilence: true })
    };

    const request = rpc['materials.requestMaterialGeneration'];

    request.mockImplementationOnce(() => Effect.fail(new StudyError('transient', 'Try again')));
    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = within(await screen.findByRole('dialog', { name: en.PracticeGenerate }));
    const generate = dialog.getByRole('button', { name: en.PracticeGenerateStart });

    await waitFor(() => expect(generate).toBeEnabled());
    await user.click(generate);
    const retry = await dialog.findByRole('button', { name: en.Retry });

    expect(retry).toBeEnabled();
    await user.click(dialog.getByText(en.PracticeCustomize));
    await user.click(await dialog.findByRole('button', { name: en.VoiceStart }));
    await user.click(await dialog.findByRole('button', { name: en.VoiceStop }));
    await waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
    expect(generate).toBeDisabled();
    expect(retry).toBeDisabled();
    await user.click(retry);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => recognition.resolve({ text: 'Spoken instructions' }));
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);
    await waitFor(() =>
      expect(request).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ instruction: 'Spoken instructions' })
      )
    );
  }
);

test.unit.stable(
  'blocks generation while provider setup is needed',
  async ({ expect, screen, vi, render, rpcHandlersTransport }) => {
    readiness.state = 'setup';

    try {
      const rpc = rpcFixture({ vi });

      mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
      expect(
        await screen.findByRole('button', { name: en.PracticeGenerateFromPages })
      ).toBeDisabled();
      expect(rpc['materials.requestMaterialGeneration']).not.toHaveBeenCalled();
    } finally {
      readiness.state = 'ready';
    }
  }
);

test.unit.stable(
  'requires a subject before offering practice generation',
  async ({ expect, screen, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi });

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice', rpc);
    expect(await screen.findByRole('button', { name: en.PracticeGenerate })).toBeDisabled();
    expect(rpc['materials.requestMaterialGeneration']).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'starts generation with saved settings and closes the dialog',
  async ({ userEvent, screen, within, waitFor, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi });
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await waitFor(() =>
      expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          projectId: 1n,
          inputs: [{ kind: 'page', versionId: 8n }],
          quizConfig: {
            questionCount: 3,
            choiceCount: 2,
            questionKind: 'mixed',
            difficulty: 'balanced'
          }
        })
      )
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: en.PracticeGenerate })).not.toBeInTheDocument()
    );
    expect(rpc['materials.materialGeneration']).toHaveBeenCalledWith({ requestId: 'generation-1' });
  }
);

test.unit.stable(
  'keeps a rejected start recoverable without closing the dialog',
  async ({ userEvent, screen, within, expect, waitFor, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi });

    rpc['materials.requestMaterialGeneration'].mockImplementationOnce(() =>
      Effect.fail(new StudyError('internal', 'Not available'))
    );
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);

    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await within(dialog).findByText(en.QuizGenerateError);
    expect(within(dialog).getByRole('radio', { name: en.SidebarQuiz })).toBeEnabled();
    expect(within(dialog).queryByText(en.QuizGenerating)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: en.Retry }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: en.PracticeGenerate })).not.toBeInTheDocument()
    );
    expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledTimes(2);
    expect(rpc['materials.requestMaterialGeneration'].mock.calls[1]?.[0]).toEqual(
      rpc['materials.requestMaterialGeneration'].mock.calls[0]?.[0]
    );
    expect(rpc['materials.materialGeneration']).toHaveBeenLastCalledWith({
      requestId: 'generation-1'
    });
  }
);

test.unit.stable(
  'selects subject notes to create a quiz when the existing material has no provenance',
  async ({ userEvent, screen, within, expect, waitFor, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi }, false);
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });
    const create = within(dialog).getByRole('button', { name: en.PracticeGenerateStart });

    const document = await within(dialog).findByRole('switch', { name: 'Prime numbers notes' });

    expect(document).toBeChecked();
    expect(create).toBeEnabled();
    await user.click(document);
    expect(create).toBeDisabled();
    await user.click(document);
    expect(create).toBeEnabled();
    await user.click(create);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: en.PracticeGenerate })).not.toBeInTheDocument()
    );
    expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ inputs: [{ kind: 'page', versionId: 8n }] })
    );
  }
);

test.unit.stable(
  'generates flashcards from explicitly loaded pages with optional filtering',
  async ({ userEvent, waitFor, expect, screen, within, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi }, false);
    const first = rpc['pages.pages'].getMockImplementation()!;
    const original = rpc['materials.materialVersion'].getMockImplementation()!;
    const extra = Schema.decodeUnknownSync(summarySchema)({
      id: 9n,
      projectIds: [1n],
      title: 'Index notes',
      description: null,
      createdAt: 1n,
      updatedAt: 1n,
      archivedAt: null,
      headVersionId: 9n
    });

    rpc['pages.pages'].mockImplementation((input) =>
      input.cursor || input.limit > 30
        ? first(input).pipe(
            Effect.map((page) => ({ items: [...page.items, extra], nextCursor: null }))
          )
        : first(input).pipe(Effect.map((page) => ({ ...page, nextCursor: extra.id })))
    );
    rpc['materials.materialVersion'].mockImplementation((input) =>
      original(input).pipe(
        Effect.map((version) => ({
          ...version,
          kind: 'flashcards' as const,
          content: { kind: 'flashcards' as const, cards: [] }
        }))
      )
    );
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice?project=1', rpc);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: en.PracticeGenerate })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: en.PracticeGenerate }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(await within(dialog).findByRole('button', { name: en.LibraryMore }));
    const selected = await within(dialog).findByRole('switch', { name: 'Index notes' });

    expect(selected).toBeChecked();
    const prime = within(dialog).getByRole('switch', { name: 'Prime numbers notes' });

    expect(prime).toBeChecked();
    await user.click(prime);
    await user.click(within(dialog).getByRole('radio', { name: en.Flashcards }));
    await user.click(within(dialog).getByText(en.PracticeCustomize));
    await user.type(
      within(dialog).getByRole('textbox', { name: en.PracticeGeneratePrompt }),
      'Focus on index tradeoffs.'
    );
    expect(
      within(dialog).queryByRole('textbox', { name: en.QuizGenerateName })
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await waitFor(() =>
      expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          kind: 'flashcards',
          autoTitle: true,
          instruction: 'Focus on index tradeoffs.',
          inputs: [{ kind: 'page', versionId: 9n }],
          quizConfig: undefined
        })
      )
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: en.PracticeGenerate })).not.toBeInTheDocument()
    );
  }
);

test.unit.stable(
  'closes after acceptance while generation remains pending and can open a fresh form',
  async ({ userEvent, screen, within, waitFor, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi });

    rpc['materials.materialGeneration'].mockReturnValue(Effect.never);
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: en.PracticeGenerate })).not.toBeInTheDocument()
    );
    expect(screen.queryByText('Leaked generation activity')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.PracticeGenerateFromPages })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    await user.click(screen.getByRole('button', { name: en.PracticeGenerateFromPages }));
    const fresh = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    expect(within(fresh).getByRole('button', { name: en.PracticeGenerateStart })).toBeEnabled();
    expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledTimes(1);
  }
);

test.unit.stable(
  'late quiz acceptance leaves a newly opened exam setup intact',
  async ({ userEvent, screen, within, waitFor, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi });
    const accepted = Promise.withResolvers<void>();
    const request = rpc['materials.requestMaterialGeneration'].getMockImplementation()!;

    rpc['materials.requestMaterialGeneration'].mockImplementation((input) =>
      Effect.promise(() => accepted.promise).pipe(Effect.andThen(request(input)))
    );
    rpc['materials.materialGeneration'].mockReturnValue(Effect.never);
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });
    const start = within(dialog).getByRole('button', { name: en.PracticeGenerateStart });

    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);
    await waitFor(() => expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledOnce());
    await user.click(within(dialog).getByText(en.Close, { exact: true }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: en.PracticeGenerate })).not.toBeInTheDocument()
    );
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const fresh = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(within(fresh).getByRole('radio', { name: en.WrittenExam }));
    accepted.resolve();
    await waitFor(() => expect(rpc['materials.materialGeneration']).toHaveBeenCalled());
    expect(fresh).toBeVisible();
    expect(within(fresh).getByRole('radio', { name: en.WrittenExam })).toBeChecked();
  }
);

for (const [kind, label] of [
  ['fill_blank', en.PracticeFillBlank],
  ['matching', en.PracticeMatching],
  ['ordering', en.PracticeOrdering],
  ['true_false', en.PracticeTrueFalse]
] as const)
  test.unit.stable(
    `generates ${kind} practice with its independent defaults`,
    async ({ userEvent, screen, within, waitFor, expect, vi, render, rpcHandlersTransport }) => {
      const rpc = rpcFixture({ vi });

      rpc['settings.quizSettings'].mockReturnValue(
        Effect.succeed({
          ...defaultQuizSettings,
          questionCount: 3,
          choiceCount: 2,
          practice: { [kind]: { questionCount: 7, difficulty: 'challenging' } }
        })
      );
      const user = userEvent.setup();

      mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
      await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
      const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

      await user.click(within(dialog).getByRole('radio', { name: label }));
      await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
      await waitFor(() =>
        expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            kind: 'quiz',
            title: label,
            autoTitle: true,
            quizConfig: {
              questionCount: 7,
              choiceCount: 2,
              questionKind: kind,
              difficulty: 'challenging'
            }
          })
        )
      );
    }
  );

test.unit.stable(
  'generates true or false practice with a typed kind and saved difficulty',
  async ({ userEvent, screen, within, waitFor, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi });
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(within(dialog).getByRole('radio', { name: 'True or false' }));
    await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await waitFor(() =>
      expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          kind: 'quiz',
          title: 'True or false',
          autoTitle: true,
          quizConfig: {
            questionCount: 3,
            choiceCount: 2,
            questionKind: 'true_false',
            difficulty: 'balanced'
          }
        })
      )
    );
  }
);

test.unit.stable(
  'generates ordering practice with a typed kind and saved difficulty',
  async ({ userEvent, screen, within, waitFor, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi });
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(within(dialog).getByRole('radio', { name: 'Put in order' }));
    await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await waitFor(() =>
      expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          kind: 'quiz',
          title: 'Put in order',
          autoTitle: true,
          quizConfig: {
            questionCount: 3,
            choiceCount: 2,
            questionKind: 'ordering',
            difficulty: 'balanced'
          }
        })
      )
    );
  }
);

test.unit.stable(
  'waits for the selected notebook before starting a quiz with the other sources',
  async ({ userEvent, screen, within, expect, waitFor, vi, render, rpcHandlersTransport }) => {
    const pending = Promise.withResolvers<void>();
    const input = { kind: 'note' as const, contextId: 'be1f8dca-8824-4f7a-81ee-14bac106e224' };
    const notebook = noteSchema.make({
      id: Schema.decodeUnknownSync(noteSchema.fields.id)(7n),
      title: 'Field notebook',
      titleSource: 'user',
      archivedAt: null,
      createdAt: 1n,
      updatedAt: 1n,
      projectIds: []
    });
    const rpc = {
      ...rpcFixture({ vi }),
      'notes.notes': () => Effect.succeed({ items: [notebook], next: null }),
      'notes.captureStudyEvidence': () => Effect.promise(() => pending.promise.then(() => input))
    };
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = within(await screen.findByRole('dialog', { name: en.PracticeGenerate }));
    const start = dialog.getByRole('button', { name: en.PracticeGenerateStart });

    await waitFor(() => expect(start).toBeEnabled());
    await user.click(await dialog.findByRole('switch', { name: notebook.title }));
    expect(start).toBeDisabled();
    expect(dialog.getByRole('switch', { name: 'Prime numbers notes' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await user.click(start);
    expect(rpc['materials.requestMaterialGeneration']).not.toHaveBeenCalled();

    pending.resolve();
    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);
    await waitFor(() => expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledOnce());
    expect(rpc['materials.requestMaterialGeneration'].mock.calls[0]?.[0].inputs).toContainEqual(
      input
    );
  }
);

test.unit.stable(
  'explains why a retained quiz instruction is too long for study notes',
  async ({
    userEvent,
    fireEvent,
    screen,
    within,
    expect,
    waitFor,
    vi,
    render,
    rpcHandlersTransport
  }) => {
    const rpc = rpcFixture({ vi });
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = within(await screen.findByRole('dialog', { name: en.PracticeGenerate }));
    const start = dialog.getByRole('button', { name: en.PracticeGenerateStart });

    await user.click(dialog.getByText(en.PracticeCustomize));
    const instruction = dialog.getByRole('textbox', { name: en.PracticeGeneratePrompt });

    fireEvent.change(instruction, {
      target: { value: 'a'.repeat(studyNotesInstructionLimit + 1) }
    });
    await user.click(dialog.getByRole('radio', { name: en.PracticeStudyNotes }));
    expect(start).toBeDisabled();
    expect(dialog.getByText(en.PracticeStudyNotesInstructionLimit)).toBeVisible();
    fireEvent.change(instruction, { target: { value: 'Organize by topic.' } });
    await waitFor(() => expect(start).toBeEnabled());
  }
);

test.unit.stable(
  'keeps page deselections when changing another page on the next window',
  async ({ userEvent, screen, within, expect, vi, render, rpcHandlersTransport }) => {
    const rpc = rpcFixture({ vi });
    const original = rpc['pages.pages'].getMockImplementation()!;
    const other = Schema.decodeUnknownSync(summarySchema)({
      id: 9n,
      projectIds: [1n],
      title: 'Second window page',
      description: null,
      createdAt: 1n,
      updatedAt: 1n,
      archivedAt: null,
      headVersionId: 9n
    });

    rpc['pages.pages'].mockImplementation((input) =>
      input.cursor
        ? Effect.succeed({ items: [other], nextCursor: null })
        : original(input).pipe(Effect.map((page) => ({ ...page, nextCursor: other.id })))
    );
    const user = userEvent.setup();

    mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
    const dialog = within(await screen.findByRole('dialog', { name: en.PracticeGenerate }));

    await user.click(await dialog.findByRole('switch', { name: 'Prime numbers notes' }));

    for (const limit of [60, 90, 100]) {
      await user.click(await dialog.findByRole('button', { name: en.LibraryMore }));
      expect(rpc['pages.pages']).toHaveBeenCalledWith(expect.objectContaining({ limit }));
    }

    await user.click(await dialog.findByRole('button', { name: en.LibraryMore }));
    await user.click(await dialog.findByRole('switch', { name: other.title }));
    await user.click(dialog.getByRole('button', { name: en.LibraryPrevious }));
    expect(await dialog.findByRole('switch', { name: 'Prime numbers notes' })).not.toBeChecked();
  }
);
