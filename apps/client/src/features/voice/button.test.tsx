import { test } from '@study/testing';
import { Suspense, startTransition, useState } from 'react';

import type * as ButtonModule from './button';

let DictationButton: typeof ButtonModule.DictationButton;

let recording: boolean;

let emitAudio: (samples: number[]) => void;

let finishTranscription: (value: { text: string }) => void;

let failTranscription: (error: Error) => void;

let transcription: Promise<{ text: string }>;

test.unit.beforeEach(async ({ mock }) => {
  recording = false;
  transcription = new Promise((resolve, reject) => {
    finishTranscription = resolve;
    failTranscription = reject;
  });
  mock('#client/lib/host.ts', () => ({
    microphoneAvailable: () => true,
    captureMicrophone: async ({ onChunk }: { onChunk: (samples: number[]) => void }) => {
      emitAudio = onChunk;
      recording = true;

      return {
        stop: async () => {
          recording = false;

          return [0.5];
        },
        cancel: () => {
          recording = false;
        }
      };
    }
  }));
  mock('@study/contracts/react', () => ({
    rpc: {
      settings: { voiceSettings: { useQuery: () => ({ data: { chunkSeconds: 30 } }) } },
      voice: {
        status: { useQuery: () => ({ data: { state: 'ready' } }) },
        transcribe: { call: () => transcription }
      }
    }
  }));
  mock('#client/features/voice/model-controls.tsx', () => ({ VoiceModelControls: () => null }));
  DictationButton = (await import('./button')).DictationButton;
});

test.unit.stable(
  'allows pointer cancellation of a failed recording through the same control',
  async ({ render, screen, userEvent, expect, vi, waitFor }) => {
    const onTranscript = vi.fn();

    render(<DictationButton onTranscript={onTranscript} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    failTranscription(new Error('Unavailable'));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dictation recovery options' })
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Dictation recovery options' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel dictation' }));
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'Start dictation' })
    ]);
    expect(onTranscript).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'delivers speech to its consumer during recording through a single control',
  async ({ render, screen, userEvent, act, expect, vi }) => {
    const onTranscript = vi.fn();

    render(<DictationButton onTranscript={onTranscript} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    const stop = await screen.findByRole('button', { name: 'Stop and transcribe' });

    await act(async () => {
      emitAudio([0.5]);
      finishTranscription({ text: 'First segment' });
      await transcription;
    });
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith('First segment');
    expect(stop).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button')).toEqual([stop]);
    expect(screen.queryByText('First segment')).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'stops recording when its draft becomes disabled',
  async ({ render, screen, userEvent, expect }) => {
    const view = render(<DictationButton onTranscript={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    await screen.findByRole('button', { name: 'Stop and transcribe' });
    expect(recording).toBe(true);
    view.rerender(<DictationButton disabled onTranscript={() => {}} />);
    expect(recording).toBe(false);
    expect(screen.queryByRole('button', { name: 'Cancel dictation' })).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'does not insert a late transcription into a disabled draft',
  async ({ render, screen, userEvent, act, expect }) => {
    let draft = 'Submitted draft';
    const insert = (text: string) => {
      draft += text;
    };
    const view = render(<DictationButton onTranscript={insert} />);

    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    view.rerender(<DictationButton disabled onTranscript={insert} />);
    await act(async () => {
      finishTranscription({ text: 'Late speech' });
      await transcription;
    });
    expect(draft).toBe('Submitted draft');
  }
);

test.unit.stable(
  'fences transcription when the mounted control changes draft identity',
  async ({ render, screen, userEvent, act, expect }) => {
    let firstDraft = 'First draft';
    let secondDraft = 'Second draft';
    const view = render(
      <DictationButton
        targetKey="first"
        onTranscript={(text) => {
          firstDraft += text;
        }}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    view.rerender(
      <DictationButton
        targetKey="second"
        onTranscript={(text) => {
          secondDraft += text;
        }}
      />
    );
    await act(async () => {
      finishTranscription({ text: 'Speech for first' });
      await transcription;
    });
    expect(firstDraft).toBe('First draft');
    expect(secondDraft).toBe('Second draft');
    expect(screen.getByRole('button', { name: 'Start dictation' })).toBeEnabled();
  }
);

test.unit.stable(
  'keeps microphone actions bound to the committed destination during a suspended navigation',
  async ({ render, screen, fireEvent, act, expect, vi }) => {
    const committedCapture = vi.fn();
    const suspendedCapture = vi.fn();
    const pending = Promise.withResolvers<void>();
    const navigationRendered = vi.fn();

    function PendingDestination({ pendingNavigation }: { pendingNavigation: boolean }) {
      if (pendingNavigation) {
        navigationRendered();

        throw pending.promise;
      }

      return <span>Committed destination</span>;
    }

    function Destinations() {
      const [pendingNavigation, setPendingNavigation] = useState(false);

      return (
        <>
          <button onClick={() => startTransition(() => setPendingNavigation(true))}>
            Navigate
          </button>
          <Suspense fallback={<span>Opening destination</span>}>
            <DictationButton
              targetKey={pendingNavigation ? 'pending' : 'committed'}
              onCaptureStart={pendingNavigation ? suspendedCapture : committedCapture}
              onTranscript={() => {}}
            />
            <PendingDestination pendingNavigation={pendingNavigation} />
          </Suspense>
        </>
      );
    }

    render(<Destinations />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Navigate' })));
    expect(navigationRendered).toHaveBeenCalled();
    expect(screen.getByText('Committed destination')).toBeVisible();
    expect(screen.queryByText('Opening destination')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    expect(committedCapture).toHaveBeenCalledOnce();
    expect(suspendedCapture).not.toHaveBeenCalled();
  }
);
