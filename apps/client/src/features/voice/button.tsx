import { rpc } from '@study/contracts/react';
import { CancelIcon, CopyIcon, MicrophoneIcon, StopIcon } from '@study/icons';
import {
  Button,
  Dialog,
  DialogPopup,
  DialogHeading,
  DialogFooter,
  IconButton,
  Textarea,
  Notebook,
  ErrorState,
  RetryButton
} from '@study/ui';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { captureMicrophone, microphoneAvailable } from '#client/lib/host.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { VoiceModelControls } from './model-controls';
import { DictationSession } from './session';

const session = new DictationSession(captureMicrophone, (samples, signal) =>
  rpc.voice.transcribe.call(
    {
      samples: samples.map((sample) =>
        Math.max(-32768, Math.min(32767, Math.round(sample * 32768)))
      )
    },
    { signal }
  )
);

type DictationProps = {
  onTranscript: (text: string) => void;
  onCaptureStart?: () => void;
  targetKey?: string | number | bigint;
  disabled?: boolean;
};

function useDictation({
  onTranscript,
  onCaptureStart,
  targetKey,
  disabled = false
}: DictationProps) {
  const [owner] = useState(() => Symbol('dictation'));
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const model = rpc.voice.status.useQuery({});
  const [setup, setSetup] = useState(false);
  const capturedTarget = useRef(targetKey);
  const callbacks = useRef({ onTranscript, onCaptureStart });

  useLayoutEffect(() => {
    callbacks.current = { onTranscript, onCaptureStart };
  }, [onTranscript, onCaptureStart]);
  const owned = state.owner === owner;
  const insert = () => session.insert(owner, (text) => callbacks.current.onTranscript(text));

  useEffect(() => () => session.cancel(owner), [owner, targetKey]);
  useEffect(() => {
    if (disabled) session.cancel(owner);
  }, [disabled, owner]);
  useEffect(() => {
    const sameTarget = capturedTarget.current === targetKey;

    if (!disabled && owned && sameTarget && state.phase === 'result' && !state.error)
      session.insert(owner, (text) => callbacks.current.onTranscript(text));
  }, [disabled, owned, owner, state, targetKey]);
  useEscapeCancellation(owned, owner);

  const begin = () => {
    if (disabled) return;

    capturedTarget.current = targetKey;
    callbacks.current.onCaptureStart?.();
    void session.start(owner);
  };
  const start = () => {
    if (disabled) return;

    if (model.data?.state !== 'ready') {
      setSetup(true);

      return;
    }

    begin();
  };

  return {
    state,
    owned,
    owner,
    disabled,
    setup,
    setSetup,
    start,
    begin,
    insert,
    ready: model.data?.state === 'ready'
  };
}

type Model = ReturnType<typeof useDictation>;

function useEscapeCancellation(owned: boolean, owner: symbol) {
  useEffect(() => {
    if (!owned) return;

    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      event.stopPropagation();
      session.cancel(owner);
    };

    document.addEventListener('keydown', key, true);

    return () => document.removeEventListener('keydown', key, true);
  }, [owned, owner]);
}

/** A shared, opt-in dictation control: records into its original draft and never submits it. */
export function DictationButton(props: DictationProps) {
  const model = useDictation(props);

  return (
    <>
      <DictationTrigger model={model} />
      <DictationFeedback model={model} />
      <DictationSetup model={model} />
    </>
  );
}

const phaseLabels = {
  idle: 'VoiceStart',
  starting: 'VoiceStarting',
  recording: 'VoiceStop',
  transcribing: 'VoiceTranscribing',
  result: 'VoiceStart',
  error: 'VoiceStart'
} as const;

function DictationTrigger({ model }: { model: Model }) {
  const { t } = useI18n();
  const { state, owned, owner } = model;
  const available = microphoneAvailable();
  const recording = owned && state.phase === 'recording';
  const active = owned && ['starting', 'recording', 'transcribing'].includes(state.phase);
  const phase = owned ? state.phase : 'idle';
  const label = available ? phaseLabels[phase] : 'VoiceUnavailable';
  const canStart = state.phase === 'idle' || terminalCaptureError(model);

  return (
    <Notebook.Actions>
      <IconButton
        type="button"
        label={t(label)}
        aria-pressed={recording}
        disabled={triggerDisabled(available, model.disabled, canStart, recording)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (recording) void session.stop(owner);
          else model.start();
        }}
      >
        {recording ? <StopIcon aria-hidden="true" /> : <MicrophoneIcon aria-hidden="true" />}
      </IconButton>
      {active && <Notebook.Muted role="status">{t(label)}</Notebook.Muted>}
      {owned && (
        <IconButton type="button" label={t('VoiceCancel')} onClick={() => session.cancel(owner)}>
          <CancelIcon aria-hidden="true" />
        </IconButton>
      )}
    </Notebook.Actions>
  );
}

const errorLabels = {
  capture: 'VoiceCaptureFailed',
  empty: 'VoiceNoSpeech',
  transcribe: 'VoiceTranscriptionFailed',
  insert: 'VoiceRecoveredHelp'
} as const;

function DictationFeedback({ model }: { model: Model }) {
  const { t } = useI18n();

  if (!model.owned) return null;

  const { state } = model;

  if (state.phase === 'result') return <RecoveredTranscript model={model} />;

  if (state.phase !== 'error') return null;

  return (
    <ErrorState
      layout="compact"
      title={t(errorLabels[state.error!])}
      action={
        state.error === 'transcribe' ? (
          <RetryButton
            disabled={model.disabled}
            label={t('Retry')}
            onClick={() => void session.retry(model.owner)}
          />
        ) : undefined
      }
    />
  );
}

function RecoveredTranscript({ model }: { model: Model }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  if (model.state.error !== 'insert') return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) session.cancel(model.owner);
      }}
    >
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeading title={t('VoiceRecoveredTitle')} description={t('VoiceRecoveredHelp')} />
        <Textarea
          aria-label={t('VoiceTranscript')}
          value={model.state.transcript}
          readOnly
          rows={5}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                .writeText(model.state.transcript)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            <CopyIcon aria-hidden="true" />
            {t(copied ? 'VoiceCopied' : 'Copy')}
          </Button>
          <Button type="button" disabled={model.disabled} onClick={model.insert}>
            {t('VoiceInsert')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DictationSetup({ model }: { model: Model }) {
  const { t } = useI18n();

  return (
    <Dialog open={model.setup} onOpenChange={model.setSetup}>
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeading title={t('VoiceSetupTitle')} description={t('VoiceSetupHelp')} />
        <VoiceModelControls />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => model.setSetup(false)}>
            {t('Close')}
          </Button>
          {model.ready && (
            <Button
              type="button"
              disabled={model.disabled}
              onClick={() => {
                model.setSetup(false);
                model.begin();
              }}
            >
              {t('VoiceStart')}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function triggerDisabled(available: boolean, disabled: boolean, idle: boolean, recording: boolean) {
  return !available || disabled || !(idle || recording);
}

function terminalCaptureError(model: Model) {
  return model.owned && model.state.phase === 'error' && model.state.error !== 'transcribe';
}
