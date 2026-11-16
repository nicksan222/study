import {
  StudyError,
  materialDetailSchema,
  materialVersionDetailSchema,
  summarySchema,
  projectSchema,
  defaultQuizSettings
} from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Option, Schema } from 'effect';

import {
  learningVersion,
  materialRpc,
  mountLibraryRoute
} from '#client/features/material-library/test/support.tsx';

const readiness = test.hoisted(() => ({ state: 'ready' }));

test.mock('#client/lib/ai-readiness.ts', () => ({ useAiReadiness: () => readiness.state }));

test.mock('../agent-progress', () => ({
  AgentProgress: () => <div>Leaked generation activity</div>
}));

const en = catalogs.english;

function rpcFixture(linked = true) {
  const rpc = materialRpc();

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
    'settings.quizSettings': test.vi
      .fn<StudyClient['settings.quizSettings']>()
      .mockReturnValue(
        Effect.succeed({ ...defaultQuizSettings, questionCount: 3, choiceCount: 2 })
      ),
    'materials.requestMaterialGeneration': test.vi
      .fn<StudyClient['materials.requestMaterialGeneration']>()
      .mockImplementation((input) =>
        Effect.succeed({ id: 'generation-1', ...input, inputs: [...input.inputs] })
      ),
    'materials.materialGeneration': test.vi
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

test.stable('blocks generation while provider setup is needed', async () => {
  readiness.state = 'setup';

  try {
    const rpc = rpcFixture();

    mountLibraryRoute('/practice/41?project=1', rpc);
    test
      .expect(await test.screen.findByRole('button', { name: en.PracticeGenerateFromPages }))
      .toBeDisabled();
    test.expect(rpc['materials.requestMaterialGeneration']).not.toHaveBeenCalled();
  } finally {
    readiness.state = 'ready';
  }
});

test.stable('requires a subject before offering practice generation', async () => {
  const rpc = rpcFixture();

  mountLibraryRoute('/practice', rpc);
  test.expect(await test.screen.findByRole('button', { name: en.PracticeGenerate })).toBeDisabled();
  test.expect(rpc['materials.requestMaterialGeneration']).not.toHaveBeenCalled();
});

test.stable('starts generation with saved settings and closes the dialog', async () => {
  const rpc = rpcFixture();
  const user = test.userEvent.setup();

  mountLibraryRoute('/practice/41?project=1', rpc);
  await user.click(await test.screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
  const dialog = await test.screen.findByRole('dialog', { name: en.PracticeGenerate });

  await user.click(test.within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
  await test.waitFor(() =>
    test.expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
      test.expect.objectContaining({
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
  await test.waitFor(() =>
    test
      .expect(test.screen.queryByRole('dialog', { name: en.PracticeGenerate }))
      .not.toBeInTheDocument()
  );
  test
    .expect(rpc['materials.materialGeneration'])
    .toHaveBeenCalledWith({ requestId: 'generation-1' });
});

test.stable('keeps a rejected start recoverable without closing the dialog', async () => {
  const rpc = rpcFixture();

  rpc['materials.requestMaterialGeneration'].mockImplementationOnce(() =>
    Effect.fail(new StudyError('internal', 'Not available'))
  );
  const user = test.userEvent.setup();

  mountLibraryRoute('/practice/41?project=1', rpc);

  await user.click(await test.screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
  const dialog = await test.screen.findByRole('dialog', { name: en.PracticeGenerate });

  await user.click(test.within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
  await test.within(dialog).findByText(en.QuizGenerateError);
  test.expect(test.within(dialog).getByRole('radio', { name: en.SidebarQuiz })).toBeEnabled();
  test.expect(test.within(dialog).queryByText(en.QuizGenerating)).toBeNull();
  await user.click(test.within(dialog).getByRole('button', { name: en.Retry }));
  await test.waitFor(() =>
    test
      .expect(test.screen.queryByRole('dialog', { name: en.PracticeGenerate }))
      .not.toBeInTheDocument()
  );
  test.expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledTimes(2);
  test
    .expect(rpc['materials.requestMaterialGeneration'].mock.calls[1]?.[0])
    .toEqual(rpc['materials.requestMaterialGeneration'].mock.calls[0]?.[0]);
  test.expect(rpc['materials.materialGeneration']).toHaveBeenLastCalledWith({
    requestId: 'generation-1'
  });
});

test.stable(
  'selects subject notes to create a quiz when the existing material has no provenance',
  async () => {
    const rpc = rpcFixture(false);
    const user = test.userEvent.setup();

    mountLibraryRoute('/practice/41?project=1', rpc);
    await user.click(
      await test.screen.findByRole('button', { name: en.PracticeGenerateFromPages })
    );
    const dialog = await test.screen.findByRole('dialog', { name: en.PracticeGenerate });
    const create = test.within(dialog).getByRole('button', { name: en.PracticeGenerateStart });

    const document = await test
      .within(dialog)
      .findByRole('switch', { name: 'Prime numbers notes' });

    test.expect(document).toBeChecked();
    test.expect(create).toBeEnabled();
    await user.click(document);
    test.expect(create).toBeDisabled();
    await user.click(document);
    test.expect(create).toBeEnabled();
    await user.click(create);
    await test.waitFor(() =>
      test
        .expect(test.screen.queryByRole('dialog', { name: en.PracticeGenerate }))
        .not.toBeInTheDocument()
    );
    test
      .expect(rpc['materials.requestMaterialGeneration'])
      .toHaveBeenCalledExactlyOnceWith(
        test.expect.objectContaining({ inputs: [{ kind: 'page', versionId: 8n }] })
      );
  }
);

test.stable(
  'generates flashcards from explicitly loaded pages with optional filtering',
  async () => {
    const rpc = rpcFixture(false);
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
    const user = test.userEvent.setup();

    mountLibraryRoute('/practice?project=1', rpc);
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: en.PracticeGenerate })).toBeEnabled()
    );
    await user.click(test.screen.getByRole('button', { name: en.PracticeGenerate }));
    const dialog = await test.screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(await test.within(dialog).findByRole('button', { name: en.LibraryMore }));
    const selected = await test.within(dialog).findByRole('switch', { name: 'Index notes' });

    test.expect(selected).toBeChecked();
    const prime = test.within(dialog).getByRole('switch', { name: 'Prime numbers notes' });

    test.expect(prime).toBeChecked();
    await user.click(prime);
    await user.click(test.within(dialog).getByRole('radio', { name: en.Flashcards }));
    await user.click(test.within(dialog).getByText(en.PracticeCustomize));
    await user.type(
      test.within(dialog).getByRole('textbox', { name: en.PracticeGeneratePrompt }),
      'Focus on index tradeoffs.'
    );
    test
      .expect(test.within(dialog).queryByRole('textbox', { name: en.QuizGenerateName }))
      .not.toBeInTheDocument();
    await user.click(test.within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await test.waitFor(() =>
      test.expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
        test.expect.objectContaining({
          kind: 'flashcards',
          autoTitle: true,
          instruction: 'Focus on index tradeoffs.',
          inputs: [{ kind: 'page', versionId: 9n }],
          quizConfig: undefined
        })
      )
    );
    await test.waitFor(() =>
      test
        .expect(test.screen.queryByRole('dialog', { name: en.PracticeGenerate }))
        .not.toBeInTheDocument()
    );
  }
);

test.stable(
  'closes after acceptance while generation remains pending and can open a fresh form',
  async () => {
    const rpc = rpcFixture();

    rpc['materials.materialGeneration'].mockReturnValue(Effect.never);
    const user = test.userEvent.setup();

    mountLibraryRoute('/practice/41?project=1', rpc);
    await user.click(
      await test.screen.findByRole('button', { name: en.PracticeGenerateFromPages })
    );
    const dialog = await test.screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(test.within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await test.waitFor(() =>
      test
        .expect(test.screen.queryByRole('dialog', { name: en.PracticeGenerate }))
        .not.toBeInTheDocument()
    );
    test.expect(test.screen.queryByText('Leaked generation activity')).not.toBeInTheDocument();
    test
      .expect(test.screen.getByRole('button', { name: en.PracticeGenerateFromPages }))
      .toHaveAttribute('aria-busy', 'true');
    await user.click(test.screen.getByRole('button', { name: en.PracticeGenerateFromPages }));
    const fresh = await test.screen.findByRole('dialog', { name: en.PracticeGenerate });

    test
      .expect(test.within(fresh).getByRole('button', { name: en.PracticeGenerateStart }))
      .toBeEnabled();
    test.expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledTimes(1);
  }
);

for (const [kind, label] of [
  ['fill_blank', en.PracticeFillBlank],
  ['matching', en.PracticeMatching],
  ['ordering', en.PracticeOrdering],
  ['true_false', en.PracticeTrueFalse]
] as const)
  test.stable(`generates ${kind} practice with its independent defaults`, async () => {
    const rpc = rpcFixture();

    rpc['settings.quizSettings'].mockReturnValue(
      Effect.succeed({
        ...defaultQuizSettings,
        questionCount: 3,
        choiceCount: 2,
        practice: { [kind]: { questionCount: 7, difficulty: 'challenging' } }
      })
    );
    const user = test.userEvent.setup();

    mountLibraryRoute('/practice/41?project=1', rpc);
    await user.click(
      await test.screen.findByRole('button', { name: en.PracticeGenerateFromPages })
    );
    const dialog = await test.screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(test.within(dialog).getByRole('radio', { name: label }));
    await user.click(test.within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await test.waitFor(() =>
      test.expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
        test.expect.objectContaining({
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
  });

test.stable('generates true or false practice with a typed kind and saved difficulty', async () => {
  const rpc = rpcFixture();
  const user = test.userEvent.setup();

  mountLibraryRoute('/practice/41?project=1', rpc);
  await user.click(await test.screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
  const dialog = await test.screen.findByRole('dialog', { name: en.PracticeGenerate });

  await user.click(test.within(dialog).getByRole('radio', { name: 'True or false' }));
  await user.click(test.within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
  await test.waitFor(() =>
    test.expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
      test.expect.objectContaining({
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
});

test.stable('generates ordering practice with a typed kind and saved difficulty', async () => {
  const rpc = rpcFixture();
  const user = test.userEvent.setup();

  mountLibraryRoute('/practice/41?project=1', rpc);
  await user.click(await test.screen.findByRole('button', { name: en.PracticeGenerateFromPages }));
  const dialog = await test.screen.findByRole('dialog', { name: en.PracticeGenerate });

  await user.click(test.within(dialog).getByRole('radio', { name: 'Put in order' }));
  await user.click(test.within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
  await test.waitFor(() =>
    test.expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
      test.expect.objectContaining({
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
});
