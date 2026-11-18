import { rpc } from '@study/contracts/react';
import { CancelIcon, CopyIcon, ErrorIcon, MicrophoneIcon } from '@study/icons';
import type { StaticMessageKey } from '@study/localization';
import {
  Button,
  Dialog,
  DialogPopup,
  DialogBody,
  DialogHeading,
  DialogFooter,
  DialogTrigger,
  ErrorState,
  IconButton,
  Notebook,
  RecordingControls,
  RecordingFeedback,
  RetryButton,
  Textarea
} from '@study/ui';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement, Ref } from 'react';

import { captureMicrophone, microphoneAvailable } from '#client/lib/host.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { VoiceModelControls } from './model-controls';
import { DictationSession } from './session';
import { useDictationSubmissionOwner } from './submission';

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

  useDictationSubmissionOwner(owner, session);

  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const model = rpc.voice.status.useQuery({});
  const preferences = rpc.settings.voiceSettings.useQuery({});
  const [setup, setSetup] = useState(false);
  const [capturedTarget, setCapturedTarget] = useState<typeof targetKey>();
  const callbacks = useRef({ onTranscript, onCaptureStart, targetKey, disabled });
  const originalTarget = capturedTarget === targetKey;

  useLayoutEffect(() => {
    callbacks.current = { onTranscript, onCaptureStart, targetKey, disabled };
  }, [onTranscript, onCaptureStart, targetKey, disabled]);
  const owned = state.owner === owner;
  const insert = () => {
    const current = callbacks.current;

    if (!current.disabled && capturedTarget === current.targetKey)
      session.insert(owner, current.onTranscript);
  };

  useLayoutEffect(() => {
    if ((!originalTarget || disabled) && session.snapshot().phase !== 'result')
      session.cancel(owner);
  }, [disabled, originalTarget, owner]);
  useLayoutEffect(() => () => session.cancel(owner), [owner]);
  useEscapeCancellation(owned && canCancelCapture(state.phase), owner);

  const begin = () => {
    if (disabled) return;

    setCapturedTarget(targetKey);
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
    canInsert: originalTarget && !disabled,
    setup,
    setSetup,
    start,
    begin,
    insert,
    ready: model.data?.state === 'ready'
  };
}

type Model = ReturnType<typeof useDictation>;

function canCancelCapture(phase: Model['state']['phase']) {
  return phase === 'starting' || phase === 'recording' || phase === 'transcribing';
}

function useEscapeCancellation(active: boolean, owner: symbol) {
  useEffect(() => {
    if (!active) return;

    const key = (event: KeyboardEvent) => {
      const state = session.snapshot();

      if (event.key !== 'Escape' || state.owner !== owner || !canCancelCapture(state.phase)) return;

      event.preventDefault();
      event.stopPropagation();
      session.cancel(owner);
    };

    document.addEventListener('keydown', key, true);

    return () => document.removeEventListener('keydown', key, true);
  }, [active, owner]);
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
  const primary = useRef<HTMLButtonElement>(null);
  const control = triggerState(model);
  const { error, active, progress } = control;
  const finish = (transferFocus: boolean) => {
    if (transferFocus) primary.current?.focus();

    void session.stop(model.owner);
  };

  return (
    <Notebook.Actions>
      <RecordingControls label={active ? t('VoiceTitle') : undefined}>
        <DictationAction model={model} control={control} ref={primary} />
        {active && (
          <RecordingFeedback
            progress={progress ? t(progress) : undefined}
            finishLabel={t('VoiceStop')}
            recordingLabel={t('VoiceRecording')}
            disabled={control.disabled}
            onFinish={finish}
            subscribeLevel={session.subscribeLevel}
          />
        )}
        <ErrorState layout="announcement" title={error ? t(errorLabels[error]) : ''} />
      </RecordingControls>
    </Notebook.Actions>
  );
}

function DictationAction({
  model,
  control: { active, error, label, retry, disabled },
  ref
}: {
  model: Model;
  control: ReturnType<typeof triggerState>;
  ref: Ref<HTMLButtonElement>;
}) {
  const { t } = useI18n();
  const cancel = () => session.cancel(model.owner);
  const button = (
    <IconButton
      ref={ref}
      type="button"
      label={t(label)}
      tooltip={error ? t(errorLabels[error]) : undefined}
      size={active ? 'icon-sm' : 'icon-xs'}
      variant={error ? 'warning-outline' : 'ghost'}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={retry ? undefined : active ? cancel : model.start}
    >
      <TriggerIcon active={active} error={!!error} />
    </IconButton>
  );

  return retry ? <DictationRetry model={model} trigger={button} /> : button;
}

function triggerState({ state, owned, disabled }: Model) {
  const available = microphoneAvailable();
  const progress = owned ? progressLabel(state) : undefined;
  const active = owned && (state.phase === 'recording' || !!progress);
  const error = owned && state.phase === 'error' ? state.error : undefined;
  const retry = error === 'transcribe';
  const enabled = canUseTrigger(state, active || retry);

  return {
    error,
    retry,
    active,
    progress,
    label: triggerLabel(available, active, retry),
    disabled: !available || disabled || !enabled
  };
}

function canUseTrigger(state: Model['state'], active: boolean) {
  if (state.phase === 'idle') return true;

  if (state.phase === 'error' && state.error !== 'transcribe') return true;

  return active;
}

function progressLabel({ phase, backlog }: Model['state']): StaticMessageKey | undefined {
  if (phase === 'starting') return 'VoiceStarting';

  if (phase === 'transcribing') return backlog ? 'VoiceFinishingBacklog' : 'VoiceTranscribing';

  return undefined;
}

function triggerLabel(available: boolean, active: boolean, retry: boolean): StaticMessageKey {
  if (!available) return 'VoiceUnavailable';

  if (active) return 'VoiceCancel';

  if (retry) return 'VoiceRecoveryOptions';

  return 'VoiceStart';
}

function TriggerIcon({ active, error }: { active: boolean; error: boolean }) {
  if (active) return <CancelIcon aria-hidden="true" />;

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
      <DialogPopup closeLabel={t('Close')}>
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
          description={t(model.canInsert ? errorLabels[model.state.error] : 'VoiceRecoveryMoved')}
        />
        <Textarea
          aria-label={t('VoiceTranscript')}
          value={model.state.transcript}
          readOnly
          rows={5}
        />
        <DialogFooter>
          <CopyTranscript value={model.state.transcript} />
          <Button type="button" disabled={!model.canInsert} onClick={model.insert}>
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
        <DialogBody>
          <VoiceModelControls />
        </DialogBody>
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
