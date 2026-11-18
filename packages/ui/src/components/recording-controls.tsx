import { AcceptIcon } from '@study/icons';
import { useEffect, useRef, useState } from 'react';
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
  recordingLabel,
  disabled,
  onFinish,
  subscribeLevel
}: {
  progress?: string;
  finishLabel: string;
  recordingLabel: string;
  disabled: boolean;
  onFinish: (transferFocus: boolean) => void;
  subscribeLevel: SubscribeLevel;
}) {
  if (progress) return <Spinner size="xs" label={progress} />;

  return (
    <>
      <RecordingTime label={recordingLabel} />
      <VoiceWaveform subscribe={subscribeLevel} />
      <IconButton
        label={finishLabel}
        className="voice-capture-finish"
        size="icon"
        variant="default"
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

function RecordingTime({ label }: { label: string }) {
  const [started] = useState(Date.now);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 250);

    return () => clearInterval(timer);
  }, [started]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, '0');

  return (
    <span className="voice-capture-time">
      <span className="voice-capture-indicator" aria-hidden="true" />
      <span className="sr-only">{label} </span>
      <time dateTime={`PT${elapsed}S`}>{`${minutes}:${seconds}`}</time>
    </span>
  );
}

const bars = Array.from({ length: 17 }, (_, index) => index);

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
