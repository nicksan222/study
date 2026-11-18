import { AcceptIcon } from '@study/icons';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { IconButton } from './icon-button';
import { Spinner } from './spinner';

import './recording-controls.css';

type SubscribeLevel = (handle: (level: number) => void) => () => void;

export function RecordingControls({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <span
      className="voice-capture-controls"
      data-active={label ? true : undefined}
      role={label ? 'group' : undefined}
      aria-label={label}
    >
      {children}
    </span>
  );
}

export function RecordingFeedback({
  progress,
  finishLabel,
  disabled,
  onFinish,
  subscribeLevel
}: {
  progress?: string;
  finishLabel: string;
  disabled: boolean;
  onFinish: (transferFocus: boolean) => void;
  subscribeLevel: SubscribeLevel;
}) {
  if (progress) return <Spinner size="xs" label={progress} />;

  return (
    <>
      <VoiceWaveform subscribe={subscribeLevel} />
      <IconButton
        label={finishLabel}
        variant="secondary"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) =>
          onFinish(event.currentTarget === event.currentTarget.ownerDocument.activeElement)
        }
      >
        <AcceptIcon aria-hidden="true" />
      </IconButton>
    </>
  );
}

const bars = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

function VoiceWaveform({ subscribe }: { subscribe: SubscribeLevel }) {
  const waveform = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const elements = waveform.current?.children;
    const levels = bars.map(() => 0);

    return subscribe((level) => {
      levels.shift();
      levels.push(Math.min(1, Math.max(0, level * 5)));

      for (const [index, amplitude] of levels.entries()) {
        const bar = elements?.item(index);

        if (bar instanceof HTMLElement)
          bar.style.setProperty('--voice-amplitude', String(amplitude));
      }
    });
  }, [subscribe]);

  return (
    <span className="voice-capture-waveform" aria-hidden="true" ref={waveform}>
      {bars.map((bar) => (
        <span key={bar} />
      ))}
    </span>
  );
}
