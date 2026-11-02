import { citationPageSchema } from '@study/contracts/materials/rpc';
import { catalogs } from '@study/localization';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, it, vi } from 'vite-plus/test';

import type { StudyClient } from '../../lib/study-client/client';
import { materialRpc, mountLibraryRoute } from './test/support';

vi.mock('../../lib/study-client/request', () => ({ request: vi.fn() }));

it.each([
  [
    'assessed',
    'contradicts',
    catalogs.english.DocumentContradicts,
    catalogs.english.DocumentUserAssessed
  ],
  ['stale', 'uncertain', catalogs.english.DocumentUncertain, catalogs.english.DocumentStale],
  ['unavailable', 'supports', catalogs.english.DocumentSupports, catalogs.english.ReaderUnavailable]
] as const)(
  'shows the actual %s judgment %s and note independently of evidence availability',
  async (state, judgment, label, status) => {
    const range = { versionId: 101n, documentId: 1101n, blockId: 'b0', start: 0, end: 10 };
    const target = { materialId: 41n, range };
    const unavailable = {
      availability: 'unavailable',
      precision: 'unavailable',
      reference: { kind: 'range', target },
      reason: 'version_pruned'
    };
    const page = Schema.decodeUnknownSync(citationPageSchema)({
      items: [
        {
          marker: 1n,
          inputVersionId: 101n,
          anchor: { type: 'authored' },
          quote: 'A disputed claim',
          evidence: unavailable,
          support: {
            state,
            claim: unavailable,
            evidence: unavailable,
            reasons: state === 'assessed' ? [] : ['target_unavailable'],
            assessment: {
              claim: target,
              evidence: target,
              marker: 1n,
              judgment,
              note: 'My explicit reasoning',
              suppliedBy: 'user',
              independentVerification: false,
              citation: { anchor: { type: 'authored' }, quote: 'A disputed claim', target: range }
            }
          }
        }
      ],
      nextCursor: null
    });
    const rpc = {
      ...materialRpc(),
      'materials.citations': vi
        .fn<StudyClient['materials.citations']>()
        .mockReturnValue(Effect.succeed(page)),
      'materials.annotations': vi
        .fn<StudyClient['materials.annotations']>()
        .mockReturnValue(Effect.succeed({ items: [], nextCursor: null }))
    };
    mountLibraryRoute('/materials/41?version=101', rpc);
    await userEvent.setup().click(await screen.findByText(catalogs.english.DocumentEvidence));
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText('My explicit reasoning')).toBeInTheDocument();
    const citation = screen.getByText('A disputed claim').closest('blockquote')!;
    expect(citation).toHaveTextContent(status);
    expect(citation).toHaveTextContent(catalogs.english.ReaderUnavailable);
    expect(screen.getByText(catalogs.english.DocumentEvidenceExplanation)).toBeInTheDocument();
  }
);
