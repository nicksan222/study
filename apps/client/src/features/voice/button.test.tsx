import { test } from '@study/testing';
import { Suspense, startTransition, useState, useSyncExternalStore } from 'react';

import { readyVoiceStatus } from '#client/test/page-values.ts';

import type * as ButtonModule from './button';

let DictationButton: typeof ButtonModule.DictationButton;

let recording: boolean;

let modelState: 'ready' | 'missing';

const modelListeners = new Set<() => void>();

function setModelState(state: typeof modelState) {
  modelState = state;

  for (const listener of modelListeners) listener();
}

function subscribeModel(listener: () => void) {
  modelListeners.add(listener);

  return () => modelListeners.delete(listener);
}

let emitAudio: (samples: number[]) => void;

let emitLevel: (level: number) => void;

let finishTranscription: (value: { text: string }) => void;

let failTranscription: (error: unknown) => void;

let transcription: Promise<{ text: string }>;

let transcriptionRequested: ReturnType<typeof Promise.withResolvers<void>>;

test.unit.beforeEach(async ({ mock }) => {
  recording = false;
  modelState = 'ready';
  transcriptionRequested = Promise.withResolvers();
  transcription = new Promise((resolve, reject) => {
    finishTranscription = resolve;
    failTranscription = reject;
  });
  mock('#client/lib/host.ts', () => ({
    microphoneAvailable: () => true,
    captureMicrophone: async ({
      onChunk,
      onLevel
    }: {
      onChunk: (samples: number[]) => void;
      onLevel: (level: number) => void;
    }) => {
      emitAudio = onChunk;
      emitLevel = onLevel;
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
  const mutation = () => ({
    isPending: false,
    isError: false,
    reset: () => {},
    mutateAsync: async () => setModelState('ready')
  });

  mock('@study/contracts/react', () => ({
    rpc: {
      settings: { voiceSettings: { useQuery: () => ({ data: { chunkSeconds: 30 } }) } },
      voice: {
        status: {
          useQuery: () => {
            const state = useSyncExternalStore(subscribeModel, () => modelState);

            return { data: { ...readyVoiceStatus, state } };
          }
        },
        install: { useMutation: mutation },
        cancelInstall: { useMutation: mutation },
        remove: { useMutation: mutation },
        transcribe: {
          call: () => {
            transcriptionRequested.resolve();

            return transcription;
          }
        }
      }
    }
  }));
  DictationButton = (await import('./button')).DictationButton;
});

test.unit.stable(
  'keeps recovery copyable when the same mounted control moves to a different draft',
  async ({ render, screen, userEvent, expect, vi }) => {
    const rejectInsertion = vi.fn(() => {
      throw new Error('No room in the original draft');
    });
    const otherDraft = vi.fn();
    const view = render(<DictationButton targetKey="first" onTranscript={rejectInsertion} />);

    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    finishTranscription({ text: 'Taken notes' });
    expect(await screen.findByRole('textbox', { name: 'Transcript' })).toHaveValue('Taken notes');

    view.rerender(<DictationButton targetKey="second" onTranscript={otherDraft} />);

    expect(screen.getByRole('textbox', { name: 'Transcript' })).toHaveValue('Taken notes');
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Retry insertion' })).toBeDisabled();
    expect(otherDraft).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'retains keyboard focus through opening and finishing a recording',
  async ({ render, screen, userEvent, expect }) => {
    render(<DictationButton onTranscript={() => {}} />);
    const start = screen.getByRole('button', { name: 'Start dictation' });

    start.focus();
    await userEvent.keyboard('{Enter}');
    const cancel = screen.getByRole('button', { name: 'Cancel dictation' });
    const finish = await screen.findByRole('button', { name: 'Stop and transcribe' });

    expect(cancel).toHaveFocus();
    finish.focus();
    await userEvent.keyboard('{Enter}');
    expect(cancel).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(start).toHaveFocus();
  }
);

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
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'Start dictation' })
    ]);
    expect(onTranscript).not.toHaveBeenCalled();
  }
);

test.unit.stable(
  'delivers speech during recording with cancel and finish in one capsule',
  async ({ render, screen, within, userEvent, act, expect, vi }) => {
    const onTranscript = vi.fn();

    render(<DictationButton onTranscript={onTranscript} />);
    const announcement = screen.getByRole('status');

    expect(announcement).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    const stop = await screen.findByRole('button', { name: 'Stop and transcribe' });

    expect(screen.getByRole('status')).toBe(announcement);
    expect(announcement).toHaveTextContent(/^Recording$/);
    expect(announcement).not.toContainElement(screen.getByText('0:00'));

    await act(async () => {
      emitAudio([0.5]);
      finishTranscription({ text: 'First segment' });
      await transcription;
    });
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith('First segment');
    expect(stop).toBeEnabled();
    const cancel = screen.getByRole('button', { name: 'Cancel dictation' });
    const controls = screen.getByRole('group', { name: 'Voice' });
    const recentBar = controls.querySelector('.voice-capture-waveform > span:last-child');

    expect(within(controls).getAllByRole('button')).toEqual([cancel, stop]);
    emitLevel(0.1);
    expect(recentBar).toHaveAttribute('style', '--voice-amplitude: 0.5;');
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
    await transcriptionRequested.promise;
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
    await transcriptionRequested.promise;
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

test.unit.stable(
  'lets another control receive Escape after a recording ends with no speech',
  async ({ render, screen, userEvent, expect, vi }) => {
    const onEscape = vi.fn();

    render(
      <>
        <DictationButton onTranscript={() => {}} />
        <button onKeyDown={onEscape}>Other control</button>
      </>
    );
    const announcement = screen.getByRole('alert');

    expect(announcement).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    finishTranscription({ text: '' });
    expect(await screen.findByText('No speech detected. Try recording again.')).toBe(announcement);

    screen.getByRole('button', { name: 'Other control' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledOnce();
    expect(announcement).toBeInTheDocument();
  }
);

test.unit.stable(
  'keeps the focused microphone action available when transcription fails',
  async ({ render, screen, userEvent, expect }) => {
    render(<DictationButton onTranscript={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Start dictation' });

    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const stop = await screen.findByRole('button', { name: 'Stop and transcribe' });

    stop.focus();
    await userEvent.keyboard('{Enter}');
    await transcriptionRequested.promise;
    expect(trigger).toHaveFocus();
    failTranscription(new Error('Unavailable'));

    const recovery = await screen.findByRole('button', { name: 'Dictation recovery options' });

    expect(recovery).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(recovery).toHaveFocus();
  }
);

test.unit.stable(
  'does not focus dictation recovery when the draft has focus',
  async ({ render, screen, userEvent, expect }) => {
    render(
      <>
        <textarea aria-label="Draft" />
        <DictationButton onTranscript={() => {}} />
      </>
    );
    const draft = screen.getByRole('textbox', { name: 'Draft' });

    draft.focus();
    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    failTranscription(new Error('Unavailable'));

    await screen.findByRole('button', { name: 'Dictation recovery options' });
    expect(draft).toHaveFocus();
  }
);

test.unit.stable.for(['denied', 'unavailable'] as const)(
  'keeps transcript available for manual copy when clipboard access is %s',
  async (clipboard, { render, screen, userEvent, expect, vi }) => {
    render(
      <DictationButton
        onTranscript={() => {
          throw new Error('No room in the draft');
        }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    finishTranscription({ text: 'Taken notes' });
    const transcript = await screen.findByRole('textbox', { name: 'Transcript' });

    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value:
        clipboard === 'denied'
          ? { writeText: vi.fn().mockRejectedValueOnce(new Error('Denied')) }
          : undefined
    });

    try {
      await userEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
      expect(await screen.findByText('Select and copy the transcript manually.')).toBeVisible();
      expect(transcript).toHaveValue('Taken notes');
      expect(transcript).toHaveAttribute('readonly');
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  }
);

test.unit.stable(
  'installs a missing model and retries the retained recording in the same draft',
  async ({ act, render, screen, userEvent, waitFor, expect, vi }) => {
    const insert = vi.fn();

    render(<DictationButton onTranscript={insert} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start dictation' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop and transcribe' }));
    await transcriptionRequested.promise;
    await act(async () => {
      setModelState('missing');
      failTranscription({
        kind: 'model_unavailable',
        message: 'Model missing',
        retryAfterMs: null
      });
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dictation recovery options' })
    );
    const retry = screen.getByRole('button', { name: 'Retry' });

    expect(retry).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Download model' }));
    expect(retry).toBeEnabled();
    transcription = Promise.resolve({ text: 'Retained audio' });
    await userEvent.click(retry);
    await waitFor(() => expect(insert).toHaveBeenCalledExactlyOnceWith('Retained audio'));
  }
);
