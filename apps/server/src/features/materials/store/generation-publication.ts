/** @file Owns generation publication within this feature. */

import type { resolvedContentInputSchema } from '@study/contracts';
import {
  StudyError,
  contentInputKey,
  materialGenerationPublicationSchema,
  validBlockTextRange
} from '@study/contracts';
import * as s from '@study/db';
import { eq } from '@study/db';
import { CryptoHasher } from 'bun';
import { Schema } from 'effect';

import { canonicalJson } from '#server/features/materials/decoders/edit-intent';
import {
  assertQuestionSpec,
  assertQuizConfig
} from '#server/features/materials/decoders/question-spec';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeCreateMaterial } from './create-material.ts';
import { makeGenerationEvents } from './generation-events.ts';
import { makeGenerationQueries } from './generation-queries.ts';
import { makeGenerationScope } from './generation-scope.ts';
import { makeGenerationValidation } from './generation-validation.ts';
import { required } from './reads.ts';
import { makeSetCitations } from './set-citations.ts';
import { makeWrites } from './writes.ts';

export function makeGenerationPublication(resources: StoreResources) {
  const { db } = resources;
  const { publish } = makeWrites(resources);
  const { readGeneration } = makeGenerationQueries(resources);
  const { assertNotCancelled, validateInputs } = makeGenerationValidation(resources);
  const { assertActiveScope } = makeGenerationScope(resources);
  const { assertGenerationEvent } = makeGenerationEvents(resources);
  const { createMaterial } = makeCreateMaterial(resources);

  const { setCitations } = makeSetCitations(resources);

  const publicationCodec = Schema.fromJsonString(
    Schema.toCodecJson(materialGenerationPublicationSchema)
  );

  function publishGeneration(
    input: typeof materialGenerationPublicationSchema.Type & {
      inputSnapshots: readonly (typeof resolvedContentInputSchema.Type)[];
    }
  ) {
    const value = Schema.decodeUnknownSync(materialGenerationPublicationSchema)(input);

    const citations = [...value.citations].sort((a, b) =>
      a.marker < b.marker ? -1 : a.marker > b.marker ? 1 : 0
    );

    const hash = new CryptoHasher('sha256')
      .update(
        canonicalJson(
          Schema.encodeSync(publicationCodec)({
            requestId: value.requestId,
            ...(value.title === undefined ? {} : { title: value.title }),
            content: value.content,
            language: value.language,
            citations
          })
        )
      )
      .digest('hex');

    const row = required(
      db.orm
        .select()
        .from(s.material_generation_requests)
        .where(eq(s.material_generation_requests.id, value.requestId))
        .get()
    );

    if (row.result_version_id !== null) {
      if (row.result_hash !== hash)
        throw new StudyError('invalid_input', 'Generation result differs from committed result');

      return { versionId: row.result_version_id, event: null };
    }

    const request = required(readGeneration(value.requestId));

    assertNotCancelled(request);

    assertActiveScope(request);

    validateInputs(request);

    assertGenerationContent(request, value);

    const resolved = citations.map((citation) =>
      resolveGenerationCitation(request, citation, input.inputSnapshots)
    );

    const event = assertGenerationEvent(request, value.generationEventId ?? request.id);

    const result = createGenerationOutput(request, value, resolved);

    db.orm
      .update(s.material_generation_requests)
      .set({
        result_version_id: result.versionId,
        result_hash: hash
      })
      .where(eq(s.material_generation_requests.id, request.id))
      .run();

    return {
      ...result,
      event
    };
  }

  function createGenerationOutput(
    request: NonNullable<ReturnType<typeof readGeneration>>,
    value: typeof materialGenerationPublicationSchema.Type,
    resolved: ReturnType<typeof resolveGenerationCitation>[]
  ) {
    const versionInput = {
      content: value.content,
      inputs: request.inputs,
      operation: 'generate' as const,
      language: value.language,
      publish: false
    };

    const material = createMaterial({
      ...versionInput,
      projectId: request.projectId,
      title: request.autoTitle ? required(value.title) : request.title
    });

    db.orm
      .update(s.material_versions)
      .set({
        creator: 'agent',
        instruction: request.instruction ?? null,
        generation_request_id: request.id
      })
      .where(eq(s.material_versions.id, material.version.id))
      .run();

    setCitations({ id: material.version.id, citations: resolved });

    publish(material.version.id);

    return { versionId: material.version.id, materialId: material.id };
  }

  function resolveGenerationCitation(
    request: NonNullable<ReturnType<typeof readGeneration>>,
    citation: (typeof materialGenerationPublicationSchema.Type)['citations'][number],
    snapshots: readonly (typeof resolvedContentInputSchema.Type)[]
  ) {
    const key = contentInputKey(citation.input);
    const selected = snapshots.find((snapshot) => contentInputKey(snapshot.input) === key);

    if (!selected || !request.inputs.some((input) => contentInputKey(input) === key))
      throw new StudyError('invalid_input', 'Citation is outside exact learning inputs');

    const block = selected.document.blocks[citation.blockOrdinal];

    if (!block || !block.text.includes(citation.quote))
      throw new StudyError('invalid_input', 'Citation does not match its exact source block');

    if (
      citation.target &&
      (citation.target.blockId !== block.id ||
        !validBlockTextRange(selected.document, citation.target) ||
        !block.text.slice(citation.target.start, citation.target.end).includes(citation.quote))
    )
      throw new StudyError(
        'invalid_input',
        'Citation target does not match its exact source passage'
      );

    return {
      marker: citation.marker,
      input: citation.input,
      anchor: block.anchor,
      target: citation.target,
      quote: citation.quote
    };
  }

  function assertGenerationContent(
    request: NonNullable<ReturnType<typeof readGeneration>>,
    value: typeof materialGenerationPublicationSchema.Type
  ) {
    if (request.autoTitle && value.title === undefined)
      throw new StudyError('invalid_input', 'Automatic generation requires a title');

    assertQuestionSpec(request.questionSpec, value.content);
    assertQuizConfig(request.quizConfig, value.content);

    if (value.content.kind !== request.kind)
      throw new StudyError('invalid_input', 'Generation kind mismatch');

    if (value.citations.length === 0)
      throw new StudyError('invalid_input', 'Generated content must cite captured evidence');

    if (new Set(value.citations.map((c) => c.marker)).size !== value.citations.length)
      throw new StudyError('invalid_input', 'Duplicate citation markers');
  }

  return { publishGeneration };
}
