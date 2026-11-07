import type { Source } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { MaterialLibrary } from '@study/ui/material-library';
import { StatusMessage } from '@study/ui/status-message';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '#web/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import {
  audioCapabilityOptions,
  useSourceTranscription,
  useTranscriptionModel,
  useTranscriptionState
} from './transcription.queries';

export function SourceTranscription({
  source,
  hasDocument
}: {
  source: Source;
  hasDocument: boolean;
}) {
  const { t } = useI18n();
  const model = useTranscriptionModel();
  const mutation = useSourceTranscription(source.id);
  const state = useTranscriptionState(source.id);
  const capability = useQuery(audioCapabilityOptions(source.mime));

  if (!capability.data) return null;

  if (capability.data.path !== 'audio')
    return <StatusMessage>{t('UnsupportedAudioTranscription')}</StatusMessage>;

  return (
    <>
      <TranscriptionNotice hasDocument={hasDocument} installed={!!model.query.data?.installed} />
      <MaterialLibrary.Actions>
        <Button
          variant="outline"
          size="sm"
          disabled={!model.query.data?.installed || mutation.isPending || state.active}
          onClick={() => mutation.mutate()}
        >
          {t(hasDocument ? 'TranscribeAgain' : 'TranscribeAudio')}
        </Button>
      </MaterialLibrary.Actions>
      {mutation.error && (
        <ContentReadError error={mutation.error} retry={() => mutation.mutate()} />
      )}
      <TranscriptionProgress active={state.active} failed={state.failed} />
    </>
  );
}

function TranscriptionNotice({
  hasDocument,
  installed
}: {
  hasDocument: boolean;
  installed: boolean;
}) {
  const { t } = useI18n();

  if (hasDocument) return null;

  return (
    <StatusMessage>
      {t(installed ? 'TranscriptionManualHelp' : 'TranscriptionInstallHelp')}
    </StatusMessage>
  );
}

function TranscriptionProgress({ active, failed }: { active: boolean; failed: boolean }) {
  const { t } = useI18n();

  if (active) return <StatusMessage>{t('SessionPending')}</StatusMessage>;

  if (failed) return <StatusMessage>{t('TranscriptionFailed')}</StatusMessage>;

  return null;
}
