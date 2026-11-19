import { startNote, useI18n, toStudyError } from '@study/client/companion';
import { configureRpcTransport } from '@study/contracts/react';
import type { ProtocolTransport } from '@study/contracts/react';
import { Button, Field, MobileStudy, StatusMessage, Textarea } from '@study/ui';
import { useContext, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import { CaptureSaveState } from './state';
import type { SaveStatus } from './state';

export function MobileCapture({ transport }: { transport: ProtocolTransport }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<File>();
  const { status, setStatus } = useContext(CaptureSaveState)!;
  const locked = status === 'sending' || status === 'uncertain';

  useEffect(() => configureRpcTransport(transport), [transport]);

  function clearCapture() {
    setText('');
    setPhoto(undefined);
  }

  async function save() {
    if (locked || (!text.trim() && !photo)) return;

    setStatus('sending');

    try {
      await startNote({ text: text.trim(), files: photo ? [photo] : [] });
      clearCapture();
      setStatus('saved');
    } catch (error) {
      setStatus(toStudyError(error).kind === 'invalid_input' ? 'rejected' : 'uncertain');
    }
  }

  return (
    <MobileStudy.Form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field label={t('MobileCaptureText')}>
        <Textarea
          value={text}
          disabled={locked}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setStatus('idle');
          }}
        />
      </Field>
      <CapturePhoto
        photo={photo}
        disabled={locked}
        onChange={(file) => {
          setPhoto(file);
          setStatus('idle');
        }}
      />
      <CaptureStatus status={status} />
      {status === 'uncertain' ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            clearCapture();
            setStatus('idle');
          }}
        >
          {t('MobileCaptureAnother')}
        </Button>
      ) : (
        <Button type="submit" disabled={locked || (!text.trim() && !photo)}>
          {t('MobileCaptureSave')}
        </Button>
      )}
    </MobileStudy.Form>
  );
}

function CaptureStatus({ status }: { status: SaveStatus }) {
  const { t } = useI18n();
  const labels = {
    sending: 'MobileCaptureSending',
    saved: 'MobileCaptureSaved',
    rejected: 'MobileCaptureRejected',
    uncertain: 'MobileCaptureUncertain'
  } as const;

  return status === 'idle' ? null : <StatusMessage>{t(labels[status])}</StatusMessage>;
}

function CapturePhoto({
  photo,
  disabled,
  onChange
}: {
  photo?: File;
  disabled: boolean;
  onChange: (photo: File | undefined) => void;
}) {
  const { t } = useI18n();
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (file) onChange(file);

    event.currentTarget.value = '';
  }

  return (
    <MobileStudy.Stack>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={select}
      />
      <input ref={library} type="file" accept="image/*" hidden onChange={select} />
      <MobileStudy.Row>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => camera.current?.click()}
        >
          {t('MobileCaptureCamera')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => library.current?.click()}
        >
          {t('MobileCaptureChoosePhoto')}
        </Button>
      </MobileStudy.Row>
      {photo && (
        <MobileStudy.Row>
          <span>{photo.name}</span>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange(undefined)}
          >
            {t('MobileCaptureRemovePhoto')}
          </Button>
        </MobileStudy.Row>
      )}
    </MobileStudy.Stack>
  );
}
