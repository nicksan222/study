import { contentInputKey, hasTextualContent } from '@study/contracts';
import type { ContentInput, ProjectId, Source, SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { ErrorState, Loading, RetryButton, Settings } from '@study/ui';
import type { Dispatch, SetStateAction } from 'react';

import {
  CursorWindowActions,
  useCursorRecovery,
  useCursorWindow
} from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

export function MaterialInputPicker({
  project,
  inputs,
  onChange,
  disabled
}: {
  project: ProjectId;
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const window = useCursorWindow<SourceId>(String(project));
  const sources = rpc.sources.list.useQuery({
    uploadedFor: project,
    limit: window.limit,
    before: window.cursor
  });

  useCursorRecovery(window, sources.error);

  return (
    <Settings.Section title={t('UploadedMaterials')}>
      {sources.isPending && <Loading label={t('LoadingStudy')} layout="panel" />}
      {sources.isError && (
        <ErrorState
          layout="inline"
          title={t('QuizInputsError')}
          action={<RetryButton label={t('Retry')} onClick={() => void sources.refetch()} />}
        />
      )}
      <Settings.Group>
        {sources.data?.items.map((source) => (
          <MaterialInput
            key={String(source.id)}
            source={source}
            inputs={inputs}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
      </Settings.Group>
      {sources.isSuccess && !sources.data?.items.length && (
        <Settings.Feedback>{t('UploadedMaterialsEmpty')}</Settings.Feedback>
      )}
      <CursorWindowActions
        {...window}
        hasMore={!!sources.data?.next}
        pending={sources.isFetching}
        more={() => window.more(sources.data?.next)}
      />
    </Settings.Section>
  );
}

function MaterialInput({
  source,
  inputs,
  onChange,
  disabled
}: {
  source: Source;
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const extraction = rpc.sources.currentExtraction.useQuery({ id: source.id });
  const current = extraction.data;
  const selected = inputs.find((input) => input.kind === 'source' && input.sourceId === source.id);
  const ready = current?.document.blocks.some((block) => hasTextualContent(block.content));
  const description = extraction.isPending
    ? 'LoadingStudy'
    : ready
      ? 'UploadedMaterialsReady'
      : 'PracticeMaterialNeedsExtraction';

  return (
    <Settings.ToggleRow
      title={source.name}
      description={t(description)}
      checked={!!selected}
      disabled={disabled || (!selected && (!ready || inputs.length >= 20))}
      onCheckedChange={(checked) => {
        if (!checked && selected) {
          const key = contentInputKey(selected);

          onChange((previous) => previous.filter((input) => contentInputKey(input) !== key));
        } else if (current && ready) {
          onChange((previous) =>
            previous.length >= 20
              ? previous
              : [
                  ...previous,
                  {
                    kind: 'source',
                    sourceId: source.id,
                    revision: current.revision,
                    snapshotId: current.snapshotId
                  }
                ]
          );
        }
      }}
    />
  );
}
