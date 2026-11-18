import { annotationSchema, assessmentViewSchema, exactInputSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import type * as Host from '#client/lib/host.ts';
import { readyVoiceStatus } from '#client/test/page-values.ts';

import type * as __MockType0 from '../document-editing/test-support';
import type * as __MockType1 from './reader-evidence';

let authoredPage: typeof __MockType0.authoredPage;

let EvidenceDetails: typeof __MockType1.EvidenceDetails;

let cancelCapture: () => void;

test.unit.beforeEach(async ({ mock }) => {
  cancelCapture = mock.fn();
  mock('#client/lib/host.ts', async (load) => ({
    ...(await load<typeof Host>()),
    microphoneAvailable: () => true,
    captureMicrophone: async () => ({ stop: async () => [0.4], cancel: cancelCapture })
  }));
  mock('#client/features/source-library/input-link', () => ({
    CapturedInputLink: ({ name }: { name: string }) => <span>{name}</span>
  }));
  const __mockModule0 = await import('../document-editing/test-support');

  authoredPage = __mockModule0.authoredPage;
  const __mockModule1 = await import('./reader-evidence');

  EvidenceDetails = __mockModule1.EvidenceDetails;
});

test.unit.stable(
  'closing Page Evidence cancels existing annotation dictation and retains edits',
  async ({ rpcHandlersTransport, render, userEvent, screen, expect, waitFor, within, act }) => {
    const version = authoredPage(41n, 'Page excerpt', 101n).version!;
    const saved = Schema.decodeUnknownSync(annotationSchema)({
      id: 1n,
      revision: 1n,
      target: {
        pageId: version.pageId,
        range: {
          versionId: version.id,
          snapshotId: version.snapshotId,
          blockId: version.document.blocks[0]!.id,
          start: 0,
          end: 4
        }
      },
      kind: 'note',
      note: 'Original annotation',
      deleted: false,
      operation: 'create'
    });
    const status = Promise.withResolvers<typeof readyVoiceStatus>();
    const harness = rpcHandlersTransport({
      'voice.status': () => Effect.promise(() => status.promise),
      'settings.voiceSettings': () => Effect.succeed({ filterSilence: true }),
      'pages.version': () => Effect.succeed(version),
      'pages.annotations': () => Effect.succeed({ items: [saved], nextCursor: null }),
      'pages.annotation': () => Effect.succeed(saved),
      'pages.annotationHistory': () => Effect.succeed({ items: [saved], nextCursor: null }),
      'pages.assessments': () => Effect.succeed({ items: [], nextCursor: null })
    });
    const user = userEvent.setup();
    const en = catalogs.english;

    render(
      <harness.wrapper>
        <EvidenceDetails version={version} />
      </harness.wrapper>
    );
    const disclosure = await screen.findByText(en.PageEvidence);

    await user.click(disclosure);
    const note = await screen.findByDisplayValue(saved.note);
    const row = within(note.closest('li')!);

    await user.type(note, ' with edits');
    await user.click(await row.findByRole('button', { name: en.VoiceStart }));
    const setup = within(await screen.findByRole('dialog', { name: en.VoiceSetupTitle }));

    await act(async () => status.resolve(readyVoiceStatus));
    await user.click(await setup.findByRole('button', { name: en.VoiceStart }));
    await row.findByRole('button', { name: en.VoiceStop });
    await user.click(disclosure);
    await waitFor(() => expect(cancelCapture).toHaveBeenCalledOnce());
    await user.click(disclosure);
    expect(await screen.findByDisplayValue('Original annotation with edits')).toBeVisible();
    expect(screen.queryByRole('button', { name: en.VoiceStop })).not.toBeInTheDocument();
  }
);

test.unit.stable.for([false, true])(
  'saves a selected passage with the appropriate note while dictation enabled is %s',
  async (
    dictate,
    { rpcHandlersTransport, render, userEvent, screen, expect, vi, fireEvent, waitFor, act, within }
  ) => {
    const version = authoredPage(41n, 'Page excerpt', 101n).version!;
    const recognition = Promise.withResolvers<{ text: string }>();
    const transcribe = vi.fn(() => Effect.promise(() => recognition.promise));
    const save = vi.fn<StudyClient['pages.createAnnotation']>().mockImplementation((input) =>
      Effect.succeed({
        outcome: 'saved',
        annotation: Schema.decodeUnknownSync(annotationSchema)({
          ...input,
          id: 1n,
          revision: 1n,
          deleted: false,
          operation: 'create'
        })
      })
    );
    const status = Promise.withResolvers<typeof readyVoiceStatus>();
    const harness = rpcHandlersTransport({
      'voice.status': () =>
        dictate ? Effect.promise(() => status.promise) : Effect.succeed(readyVoiceStatus),
      'voice.transcribe': transcribe,
      'settings.voiceSettings': () => Effect.succeed({ filterSilence: true }),
      'pages.version': () => Effect.succeed(version),
      'pages.versions': () => Effect.succeed({ items: [], nextCursor: null }),
      'pages.annotations': () => Effect.succeed({ items: [], nextCursor: null }),
      'pages.assessments': () => Effect.succeed({ items: [], nextCursor: null }),
      'pages.createAnnotation': save
    });
    const user = userEvent.setup();
    const en = catalogs.english;

    render(
      <harness.wrapper>
        <EvidenceDetails version={version} />
      </harness.wrapper>
    );
    await user.click(screen.getByText(en.PageEvidence));
    await user.click(await screen.findByLabelText(en.PageBlock));
    await user.click(await screen.findByRole('option', { name: '1 · Page excerpt' }));
    const passage = screen.getByLabelText<HTMLTextAreaElement>(en.PageSelectPassage);
    const button = screen.getByRole('button', { name: en.PageSaveAnnotation });

    passage.setSelectionRange(0, 4);
    fireEvent.select(passage);
    expect(button).toBeEnabled();

    if (dictate) {
      await user.click(await screen.findByRole('button', { name: en.VoiceStart }));
      const setup = within(await screen.findByRole('dialog', { name: en.VoiceSetupTitle }));

      await act(async () => status.resolve(readyVoiceStatus));
      await user.click(await setup.findByRole('button', { name: en.VoiceStart }));
      await user.click(await screen.findByRole('button', { name: en.VoiceStop }));
      await waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
      expect(button).toBeDisabled();
      await user.click(button);
      expect(save).not.toHaveBeenCalled();
      await act(async () => recognition.resolve({ text: 'Dictated note' }));
      await waitFor(() => expect(button).toBeEnabled());
    }

    await user.click(button);
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          kind: dictate ? 'note' : 'highlight',
          note: dictate ? 'Dictated note' : ''
        })
      )
    );
  }
);

test.unit.stable.for([false, true])(
  'shows unavailable message evidence with citations: %s',
  async (cited, { rpcHandlersTransport, render, userEvent, screen, expect }) => {
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
    const harness = rpcHandlersTransport({
      'pages.version': () => Effect.succeed(version),
      'pages.annotations': () => Effect.succeed({ items: [], nextCursor: null }),
      'pages.assessments': () => Effect.succeed({ items: [], nextCursor: null })
    });

    render(
      <harness.wrapper>
        <EvidenceDetails version={version} />
      </harness.wrapper>
    );
    await userEvent.setup().click(await screen.findByText(catalogs.english.PageEvidence));
    expect(await screen.findByText(catalogs.english.PageEvidenceUnavailable)).toBeInTheDocument();

    if (cited) {
      const citation = (await screen.findByText('Retained quote')).closest('blockquote')!;

      expect(citation).toHaveTextContent(catalogs.english.ReaderUnavailable);
    }
  }
);

test.unit.stable.for([
  ['assessed', 'contradicts', catalogs.english.PageContradicts, catalogs.english.PageUserAssessed],
  ['stale', 'uncertain', catalogs.english.PageUncertain, catalogs.english.PageStale],
  ['unavailable', 'supports', catalogs.english.PageSupports, catalogs.english.ReaderUnavailable]
] as const)(
  'shows the actual %s judgment %s and note independently of evidence availability',
  async (
    [state, judgment, label, status],
    { vi, rpcHandlersTransport, render, userEvent, screen, expect }
  ) => {
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

    const harness = rpcHandlersTransport(rpc);

    render(
      <harness.wrapper>
        <EvidenceDetails version={version} />
      </harness.wrapper>
    );
    await userEvent.setup().click(await screen.findByText(catalogs.english.PageEvidence));
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText('My explicit reasoning')).toBeInTheDocument();
    const shown = screen.getByText('A disputed claim').closest('blockquote')!;

    expect(shown).toHaveTextContent(status);
    expect(screen.getByText(catalogs.english.PageEvidenceExplanation)).toBeInTheDocument();
  }
);
