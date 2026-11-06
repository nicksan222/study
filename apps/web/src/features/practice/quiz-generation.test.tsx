import { summarySchema } from '@study/contracts/documents/schemas';
import {
  materialDetailSchema,
  materialVersionDetailSchema
} from '@study/contracts/materials/schemas';
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

testStable(
  'creates a quiz with chosen generation settings and opens the published result',
  async () => {
    const rpc = rpcFixture();
    const user = userEvent.setup();

    mountLibraryRoute('/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.QuizGenerateTitle }));
    const dialog = await screen.findByRole('dialog', { name: en.QuizGenerateTitle });

    await user.click(within(dialog).getByRole('button', { name: en.QuizGenerateStart }));
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
    const link = await within(dialog).findByRole('link', { name: en.QuizOpenGenerated });

    expect(link).toHaveAttribute('href', '/projects/1/practice/42');
    expect(rpc['materials.materialGeneration']).toHaveBeenCalledWith({ requestId: 'generation-1' });
  }
);

testStable(
  'unlocks settings after a terminal generation failure and retries a new request',
  async () => {
    const rpc = rpcFixture();
    const first = rpc['materials.materialGeneration'].getMockImplementation()!;

    rpc['materials.materialGeneration'].mockImplementationOnce((input) =>
      first(input).pipe(
        Effect.map((snapshot) => ({
          ...snapshot,
          resultVersionId: null,
          errorKind: 'internal' as const
        }))
      )
    );
    rpc['materials.requestMaterialGeneration'].mockImplementationOnce((input) =>
      Effect.succeed({ id: 'generation-failed', ...input, inputs: [...input.inputs] })
    );
    const user = userEvent.setup();

    mountLibraryRoute('/practice/41?project=1', rpc);

    await user.click(await screen.findByRole('button', { name: en.QuizGenerateTitle }));
    const dialog = await screen.findByRole('dialog', { name: en.QuizGenerateTitle });

    await user.click(within(dialog).getByRole('button', { name: en.QuizGenerateStart }));
    await within(dialog).findByText(en.QuizGenerateError);
    expect(within(dialog).getByRole('textbox', { name: en.QuizGenerateName })).toBeEnabled();
    expect(within(dialog).queryByText(en.QuizGenerating)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: en.Retry }));
    await within(dialog).findByRole('link', { name: en.QuizOpenGenerated });
    expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledTimes(2);
    expect(rpc['materials.requestMaterialGeneration'].mock.calls[1]?.[0]).toEqual(
      rpc['materials.requestMaterialGeneration'].mock.calls[0]?.[0]
    );
    expect(rpc['materials.materialGeneration']).toHaveBeenLastCalledWith({
      requestId: 'generation-1'
    });
  }
);

testStable(
  'selects subject notes to create a quiz when the existing material has no provenance',
  async () => {
    const rpc = rpcFixture(false);
    const user = userEvent.setup();

    mountLibraryRoute('/practice/41?project=1', rpc);
    await user.click(await screen.findByRole('button', { name: en.QuizGenerateTitle }));
    const dialog = await screen.findByRole('dialog', { name: en.QuizGenerateTitle });
    const create = within(dialog).getByRole('button', { name: en.QuizGenerateStart });

    expect(create).toBeDisabled();
    await user.click(await within(dialog).findByRole('switch', { name: 'Prime numbers notes' }));
    expect(create).toBeEnabled();
    await user.click(create);
    await within(dialog).findByRole('link', { name: en.QuizOpenGenerated });
    expect(rpc['materials.requestMaterialGeneration']).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ inputs: [{ kind: 'document', versionId: 8n }] })
    );
  }
);
