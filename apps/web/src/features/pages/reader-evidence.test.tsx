import { assessmentViewSchema } from '@study/contracts/pages/evidence';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { runRequest } from '#web/lib/effect/runtime.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { authoredPage } from '../document-editing/test-support';
import { EvidenceDetails } from './reader-evidence';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));
vi.mock('../source-library/input-link', () => ({
  CapturedInputLink: ({ name }: { name: string }) => <span>{name}</span>
}));

testStable.each([
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
      'pages.version': vi
        .fn<StudyClient['pages.version']>()
        .mockReturnValue(Effect.succeed(version)),
      'pages.annotations': vi
        .fn<StudyClient['pages.annotations']>()
        .mockReturnValue(Effect.succeed({ items: [], nextCursor: null })),
      'pages.assessments': vi
        .fn<StudyClient['pages.assessments']>()
        .mockReturnValue(Effect.succeed({ items: [record], nextCursor: null }))
    };

    vi.mocked(request).mockImplementation((invoke, signal) =>
      runRequest(invoke(rpc as never).pipe(Effect.mapError(toStudyError)), signal)
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EvidenceDetails version={version} />
      </QueryClientProvider>
    );
    await userEvent.setup().click(await screen.findByText(catalogs.english.PageEvidence));
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText('My explicit reasoning')).toBeInTheDocument();
    const shown = screen.getByText('A disputed claim').closest('blockquote')!;

    expect(shown).toHaveTextContent(status);
    expect(screen.getByText(catalogs.english.PageEvidenceExplanation)).toBeInTheDocument();
  }
);
