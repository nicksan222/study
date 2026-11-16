import {
  StudyError,
  comparisonSchema,
  proposalOutcomeSchema,
  applyProposalSchema,
  keepProposalSchema
} from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type * as __MockType0 from './proposal-review';
import type * as __MockType1 from './test-support';

let ProposalReview: typeof __MockType0.ProposalReview;

let authoredPage: typeof __MockType1.authoredPage;

function initializeVersion() {
  return (id: bigint) => authoredPage(41n, `Proposal body ${id}`, id).version!;
}

let version: ReturnType<typeof initializeVersion>;

function initializeComparison() {
  return (current = 101n) =>
    Schema.decodeUnknownSync(comparisonSchema)({
      beforeVersionId: 100n,
      proposedVersionId: 102n,
      currentVersionId: current,
      before: version(100n),
      proposed: version(102n),
      current: version(current),
      proposedChanges: [],
      currentChanges: [],
      evidence: 'structural_only'
    });
}

let comparison: ReturnType<typeof initializeComparison>;

const receipt = (outcome: 'applied' | 'kept' | 'conflict') =>
  Schema.decodeUnknownSync(proposalOutcomeSchema)({
    requestId: 'proposal-1',
    outcome,
    baseVersionId: 100n,
    proposedVersionId: 102n,
    currentVersionId: 101n,
    resultVersionId: outcome === 'conflict' ? null : 103n,
    replayed: false
  });

test.unit.beforeEach(async ({ mock }) => {
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children: ReactNode }) => <span>{children}</span>
  }));
  const __mockModule0 = await import('./proposal-review');

  ProposalReview = __mockModule0.ProposalReview;
  const __mockModule1 = await import('./test-support');

  authoredPage = __mockModule1.authoredPage;
  version = initializeVersion();
  comparison = initializeComparison();
});

for (const kind of ['apply', 'keep'] as const) {
  test.unit.stable(
    `explicit ${kind} retry keeps the uncertain payload through live refresh and route remount`,
    async ({ rpcTestTransport, render, fireEvent, screen, act, expect }) => {
      const attempts: unknown[] = [];
      let current = 101n;
      const fixture = rpcTestTransport(async (tag, input) => {
        if (tag === 'pages.compareProposal') return comparison(current);

        if (tag === 'pages.version') return version(103n);

        if (tag === `pages.${kind}Proposal`) {
          attempts.push(
            kind === 'apply'
              ? Schema.decodeUnknownSync(applyProposalSchema)(input)
              : Schema.decodeUnknownSync(keepProposalSchema)(input)
          );

          if (attempts.length === 1) throw new StudyError('transient', 'Receipt lost');

          return receipt(kind === 'apply' ? 'applied' : 'kept');
        }

        throw new Error(`Unexpected ${tag}`);
      });

      function Route() {
        const [visible, setVisible] = useState(true);

        return (
          <>
            <button onClick={() => setVisible((value) => !value)}>Route</button>
            {visible && <ProposalReview requestId="proposal-1" />}
          </>
        );
      }

      render(<Route />, { wrapper: fixture.wrapper });
      fireEvent.click(
        await screen.findByRole('button', {
          name: kind === 'apply' ? 'PageApply' : 'PageKeepNew'
        })
      );
      await screen.findByText('PageActionFailed');
      current = 104n;
      await act(() => fixture.notify());
      fireEvent.click(screen.getByRole('button', { name: 'Route' }));
      fireEvent.click(screen.getByRole('button', { name: 'Route' }));
      fireEvent.click(await screen.findByRole('button', { name: 'PageRetryProposal' }));
      await screen.findByText('PageProposalSaved');
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
    }
  );
}

test.unit.stable(
  'two rendered proposal controls share write ownership',
  async ({ rpcTestTransport, render, screen, fireEvent, waitFor, expect, act }) => {
    let resolve!: (value: unknown) => void;
    const calls: unknown[] = [];
    const fixture = rpcTestTransport(async (tag, input) => {
      if (tag === 'pages.compareProposal') return comparison();

      if (tag === 'pages.version') return version(103n);

      if (tag !== 'pages.applyProposal') throw new Error(`Unexpected ${tag}`);

      calls.push(input);

      return new Promise((accept) => {
        resolve = accept;
      });
    });

    render(
      <>
        <ProposalReview requestId="proposal-1" />
        <ProposalReview requestId="proposal-1" />
      </>,
      { wrapper: fixture.wrapper }
    );
    const buttons = await screen.findAllByRole('button', { name: 'PageApply' });

    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => resolve(receipt('applied')));
    await screen.findAllByText('PageProposalSaved');
  }
);
