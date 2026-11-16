import { assessmentViewSchema, exactInputSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './reader-evidence';

let authoredPage: typeof __MockType0.authoredPage;

let EvidenceDetails: typeof __MockType1.EvidenceDetails;

test.beforeEach(async ({ mock }) => {
  mock('#client/features/source-library/input-link', () => ({
    CapturedInputLink: ({ name }: { name: string }) => <span>{name}</span>
  }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('./reader-evidence');

  EvidenceDetails = __mockModule1.EvidenceDetails;
});

test.stable.each([false, true])(
  'shows unavailable message evidence with citations: %s',
  async (cited) => {
    const document = authoredPage(41n, 'An answer', 101n);
    const input = Schema.decodeUnknownSync(exactInputSchema)({ kind: 'message', versionId: 7n });
    const version = {
      ...document.version!,
      inputs: [input],
      unavailableInputs: [input],
      citations: cited
        ? [
            {
              marker: 1,
              input,
              anchor: { type: 'authored' as const },
              target: null,
              quote: 'Retained quote'
            }
          ]
        : []
    };
    const harness = test.rpcHandlersTransport({
      'pages.version': () => Effect.succeed(version),
      'pages.annotations': () => Effect.succeed({ items: [], nextCursor: null }),
      'pages.assessments': () => Effect.succeed({ items: [], nextCursor: null })
    });

    test.render(
      <harness.wrapper>
        <EvidenceDetails version={version} />
      </harness.wrapper>
    );
    await test.userEvent.setup().click(await test.screen.findByText(catalogs.english.PageEvidence));
    test
      .expect(await test.screen.findByText(catalogs.english.PageEvidenceUnavailable))
      .toBeInTheDocument();

    if (cited) {
      const citation = (await test.screen.findByText('Retained quote')).closest('blockquote')!;

      test.expect(citation).toHaveTextContent(catalogs.english.ReaderUnavailable);
    }
  }
);

test.stable.each([
  ['assessed', 'contradicts', catalogs.english.PageContradicts, catalogs.english.PageUserAssessed],
  ['stale', 'uncertain', catalogs.english.PageUncertain, catalogs.english.PageStale],
  ['unavailable', 'supports', catalogs.english.PageSupports, catalogs.english.ReaderUnavailable]
] as const)(
  'shows the actual %s judgment %s and note independently of evidence availability',
  async (state, judgment, label, status) => {
    const document = authoredPage(41n, 'A disputed claim', 101n);
    const base = document.version!;
    const input = { kind: 'page' as const, versionId: base.id };
    const range = {
      versionId: base.id,
      snapshotId: base.snapshotId,
      blockId: base.document.blocks[0]!.id,
      start: 0,
      end: 10
    };
    const citation = {
      marker: 1,
      input,
      anchor: { type: 'authored' as const },
      target: { blockId: range.blockId, start: 0, end: 10 },
      quote: 'A disputed claim'
    };
    const version = { ...base, inputs: [input], citations: [citation] };
    const record = Schema.decodeUnknownSync(assessmentViewSchema)({
      id: 1n,
      state,
      assessment: {
        claim: { pageId: document.id, range },
        evidence: input,
        evidenceRange: citation.target,
        marker: 1,
        judgment,
        note: 'My explicit reasoning',
        suppliedBy: 'user',
        independentVerification: false,
        citation
      }
    });
    const rpc = {
      'pages.version': test.vi
        .fn<StudyClient['pages.version']>()
        .mockReturnValue(Effect.succeed(version)),
      'pages.annotations': test.vi
        .fn<StudyClient['pages.annotations']>()
        .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
      'pages.assessments': test.vi
        .fn<StudyClient['pages.assessments']>()
        .mockReturnValue(Effect.succeed({ items: [record], nextCursor: null }))
    };

    const harness = test.rpcHandlersTransport(rpc);

    test.render(
      <harness.wrapper>
        <EvidenceDetails version={version} />
      </harness.wrapper>
    );
    await test.userEvent.setup().click(await test.screen.findByText(catalogs.english.PageEvidence));
    test.expect(await test.screen.findByText(label)).toBeInTheDocument();
    test.expect(test.screen.getByText('My explicit reasoning')).toBeInTheDocument();
    const shown = test.screen.getByText('A disputed claim').closest('blockquote')!;

    test.expect(shown).toHaveTextContent(status);
    test
      .expect(test.screen.getByText(catalogs.english.PageEvidenceExplanation))
      .toBeInTheDocument();
  }
);
