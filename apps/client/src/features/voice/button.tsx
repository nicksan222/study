import { rpc } from '@study/contracts/react';
import { CopyIcon, ErrorIcon, MicrophoneIcon, StopIcon } from '@study/icons';
import type { StaticMessageKey } from '@study/localization';
import {
  Button,
  Dialog,
  DialogPopup,
  DialogHeading,
  DialogFooter,
  DialogTrigger,
  ErrorState,
  IconButton,
  RetryButton,
  Spinner,
  Textarea
} from '@study/ui';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';

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
  /** Receives each recognized segment in order, including the final segment after Stop. */
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
  const preferences = rpc.settings.voiceSettings.useQuery({});
  const [setup, setSetup] = useState(false);
  const callbacks = useRef({ onTranscript, onCaptureStart });

  useLayoutEffect(() => {
    callbacks.current = { onTranscript, onCaptureStart };
  }, [onTranscript, onCaptureStart]);
  const owned = state.owner === owner;
  const insert = () => session.insert(owner, (text) => callbacks.current.onTranscript(text));

  useLayoutEffect(() => () => session.cancel(owner), [disabled, owner, targetKey]);
  useEscapeCancellation(owned, owner);

  const begin = () => {
    if (disabled) return;

    callbacks.current.onCaptureStart?.();
    void session.start(
      owner,
      (text) => callbacks.current.onTranscript(text),
      preferences.data?.chunkSeconds
    );
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

      if (event.target instanceof Element && event.target.closest('[data-dictation-retry]')) return;

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
      {model.owned && model.state.phase === 'result' && <RecoveredTranscript model={model} />}
      <DictationSetup model={model} />
    </>
  );
}

function DictationTrigger({ model }: { model: Model }) {
  const { t } = useI18n();
  const { recording, progress, error, retry, label, disabled } = triggerState(model);
  const button = (
    <IconButton
      type="button"
      label={t(label)}
      tooltip={error ? t(errorLabels[error]) : undefined}
      aria-pressed={recording}
      variant={recording || error ? 'warning-outline' : 'ghost'}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={retry ? undefined : () => activateTrigger(model, recording, !!progress)}
    >
      {progress ? (
        <Spinner label={t(progress)} />
      ) : (
        <TriggerIcon recording={recording} error={!!error} />
      )}
    </IconButton>
  );

  return (
    <>
      {retry ? <DictationRetry model={model} trigger={button} /> : button}
      {error && <ErrorState layout="announcement" title={t(errorLabels[error])} />}
    </>
  );
}

function triggerState({ state, owned, disabled }: Model) {
  const available = microphoneAvailable();
  const recording = owned && state.phase === 'recording';
  const progress = owned ? progressLabel(state) : undefined;
  const error = owned && state.phase === 'error' ? state.error : undefined;
  const retry = error === 'transcribe';
  const enabled = state.phase === 'idle' || recording || progress || error;

  return {
    recording,
    progress,
    error,
    retry,
    label: triggerLabel(available, recording, !!progress, retry),
    disabled: !available || disabled || !enabled
  };
}

function activateTrigger(model: Model, recording: boolean, busy: boolean) {
  if (recording) void session.stop(model.owner);
  else if (busy) session.cancel(model.owner);
  else model.start();
}

function progressLabel({ phase, backlog }: Model['state']): StaticMessageKey | undefined {
  if (phase === 'starting') return 'VoiceStarting';

  if (phase === 'transcribing') return backlog ? 'VoiceFinishingBacklog' : 'VoiceTranscribing';

  return undefined;
}

function triggerLabel(
  available: boolean,
  recording: boolean,
  busy: boolean,
  retry: boolean
): StaticMessageKey {
  if (!available) return 'VoiceUnavailable';

  if (recording) return 'VoiceStop';

  if (busy) return 'VoiceCancel';

  if (retry) return 'VoiceRecoveryOptions';

  return 'VoiceStart';
}

function TriggerIcon({ recording, error }: { recording: boolean; error: boolean }) {
  if (recording) return <StopIcon aria-hidden="true" />;

  if (error) return <ErrorIcon aria-hidden="true" />;

  return <MicrophoneIcon aria-hidden="true" />;
}

const errorLabels = {
  capture: 'VoiceCaptureFailed',
  empty: 'VoiceNoSpeech',
  transcribe: 'VoiceTranscriptionFailed',
  insert: 'VoiceRecoveredHelp',
  interrupted: 'VoiceInterruptedHelp'
} as const;

function DictationRetry({ model, trigger }: { model: Model; trigger: ReactElement }) {
  const { t } = useI18n();
  const { owner, state } = model;

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogPopup closeLabel={t('Close')} data-dictation-retry>
        <DialogHeading
          title={t('VoiceTranscriptionFailedTitle')}
          description={t('VoiceTranscriptionFailed')}
        />
        {state.transcript && (
          <Textarea aria-label={t('VoiceTranscript')} value={state.transcript} readOnly rows={5} />
        )}
        <DialogFooter>
          {state.transcript && <CopyTranscript value={state.transcript} />}
          <Button variant="outline" onClick={() => session.cancel(owner)}>
            {t('VoiceCancel')}
          </Button>
          <RetryButton
            label={t('Retry')}
            size="default"
            variant="default"
            disabled={model.disabled}
            onClick={() => void session.retry(owner)}
          />
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function CopyTranscript({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      <CopyIcon aria-hidden="true" />
      {t(copied ? 'VoiceCopied' : 'Copy')}
    </Button>
  );
}

function RecoveredTranscript({ model }: { model: Model }) {
  const { t } = useI18n();

  if (model.state.error !== 'insert' && model.state.error !== 'interrupted') return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) session.cancel(model.owner);
      }}
    >
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeading
          title={t('VoiceRecoveredTitle')}
          description={t(errorLabels[model.state.error])}
        />
        <Textarea
          aria-label={t('VoiceTranscript')}
          value={model.state.transcript}
          readOnly
          rows={5}
        />
        <DialogFooter>
          <CopyTranscript value={model.state.transcript} />
          <Button type="button" disabled={model.disabled} onClick={model.insert}>
            {t(model.state.error === 'interrupted' ? 'VoiceInsertRecovered' : 'VoiceInsert')}
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
