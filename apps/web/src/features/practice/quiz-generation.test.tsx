import { summarySchema } from '@study/contracts/documents/schemas';
import { StudyError } from '@study/contracts/errors';
import {
  materialDetailSchema,
  materialVersionDetailSchema
} from '@study/contracts/materials/schemas';
import { projectSchema } from '@study/contracts/projects/schemas';
import { defaultQuizSettings } from '@study/contracts/settings/types';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import {
  learningVersion,
  materialRpc,
  mountLibraryRoute
} from '#web/features/material-library/test/support.tsx';
import type { StudyClient } from '#web/lib/study-client/client.ts';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

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
  const version = Schema.decodeUnknownSync(materialVersionDetailSchema)({
    ...learningVersion(102n),
    inputs: linked
      ? [
          { kind: 'document', versionId: 8n },
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

  rpc['documents.documents'].mockReturnValue(
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

testStable('starts generation with saved settings and closes the dialog', async () => {
  const rpc = rpcFixture();
  const user = userEvent.setup();

  mountLibraryRoute('/practice/41?project=1', rpc);
  await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromDocuments }));
  const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

  await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
  await waitFor(() =>
    expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        projectId: 1n,
        inputs: [{ kind: 'document', versionId: 8n }],
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
});

testStable('keeps a rejected start recoverable without closing the dialog', async () => {
  const rpc = rpcFixture();

  rpc['materials.requestMaterialGeneration'].mockImplementationOnce(() =>
    Effect.fail(new StudyError('internal', 'Not available'))
  );
  const user = userEvent.setup();

  mountLibraryRoute('/practice/41?project=1', rpc);

  await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromDocuments }));
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
});

testStable(
  'selects subject notes to create a quiz when the existing material has no provenance',
  async () => {
    const rpc = rpcFixture(false);
    const user = userEvent.setup();

    mountLibraryRoute('/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromDocuments }));
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
      expect.objectContaining({ inputs: [{ kind: 'document', versionId: 8n }] })
    );
  }
);

testStable(
  'generates flashcards from the sidebar with all paginated documents selected and optional filtering',
  async () => {
    const rpc = rpcFixture(false);
    const first = rpc['documents.documents'].getMockImplementation()!;
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

    rpc['documents.documents'].mockImplementation((input) =>
      input.cursor
        ? Effect.succeed({ items: [extra], nextCursor: null })
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

    mountLibraryRoute('/practice?project=1', rpc);
    const generate = await screen.findByRole('button', { name: en.PracticeGenerate });

    await waitFor(() => expect(generate).toBeEnabled());
    await user.click(generate);
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });
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
          inputs: [{ kind: 'document', versionId: 9n }],
          quizConfig: undefined
        })
      )
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: en.PracticeGenerate })).not.toBeInTheDocument()
    );
  }
);

testStable(
  'closes after acceptance while generation remains pending and can open a fresh form',
  async () => {
    const rpc = rpcFixture();

    rpc['materials.materialGeneration'].mockReturnValue(Effect.never);
    const user = userEvent.setup();

    mountLibraryRoute('/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromDocuments }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: en.PracticeGenerate })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: en.PracticeGenerateFromDocuments })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    await user.click(screen.getByRole('button', { name: en.PracticeGenerateFromDocuments }));
    const fresh = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    expect(within(fresh).getByRole('button', { name: en.PracticeGenerateStart })).toBeEnabled();
    expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledTimes(1);
  }
);

testStable(
  'generates fill-in-the-blank practice with a typed kind and saved difficulty',
  async () => {
    const rpc = rpcFixture();
    const user = userEvent.setup();

    mountLibraryRoute('/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromDocuments }));
    const dialog = await screen.findByRole('dialog', { name: en.PracticeGenerate });

    await user.click(within(dialog).getByRole('radio', { name: 'Fill in the blank' }));
    await user.click(within(dialog).getByRole('button', { name: en.PracticeGenerateStart }));
    await waitFor(() =>
      expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          kind: 'quiz',
          title: 'Fill in the blank',
          autoTitle: true,
          quizConfig: {
            questionCount: 3,
            choiceCount: 2,
            questionKind: 'fill_blank',
            difficulty: 'balanced'
          }
        })
      )
    );
  }
);

testStable('generates true or false practice with a typed kind and saved difficulty', async () => {
  const rpc = rpcFixture();
  const user = userEvent.setup();

  mountLibraryRoute('/practice/41?project=1', rpc);
  await user.click(await screen.findByRole('button', { name: en.PracticeGenerateFromDocuments }));
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
});
