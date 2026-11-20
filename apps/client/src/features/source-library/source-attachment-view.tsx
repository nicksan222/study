import type { exactExtractionSchema, Source } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { mediaSize } from '@study/localization';
import {
  AttachmentPreview,
  attachmentReaderKind,
  ErrorState,
  Loading,
  SourceReader,
  Toggle,
  ToggleGroup,
  useAttachmentPreviewUrl
} from '@study/ui';
import { Schema } from 'effect';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { ContentReadError } from '../document-presentation';
import { ProcessingRetry } from './processing-retry';
import { SourcePdfPreview } from './source-pdf-preview';
import {
  FileAttachmentPreview,
  StructuredAttachmentPreview
} from './structured-attachment-preview';

type View = 'preview' | 'text' | 'details';

type ReaderMode = 'materials' | 'note' | 'citation';

type PreviewKind = NonNullable<ReturnType<typeof attachmentReaderKind>> | 'file';

type OriginalKind = Exclude<PreviewKind, 'office' | 'file'>;

type Extraction = typeof exactExtractionSchema.Type;

const encodeDigest = Schema.encodeSync(Schema.Uint8ArrayFromHex);

export function SourceAttachmentView({
  source,
  pinned,
  mode,
  extraction,
  children
}: {
  source: Source;
  pinned: boolean;
  mode: ReaderMode;
  extraction?: Extraction | null;
  children: ReactNode;
}) {
  const preview = pinned ? undefined : previewKind(source.kind, mode);
  const [selected, setSelected] = useState<View>();
  const defaultView = defaultAttachmentView(preview, mode);
  const view = (!preview && selected === 'preview' ? 'text' : selected) ?? defaultView;

  if (mode === 'citation' || pinned)
    return preview === 'pdf' ? <OriginalAttachment source={source} kind={preview} /> : children;

  return (
    <>
      <AttachmentViewSelector
        source={source}
        preview={preview}
        view={view}
        onSelect={setSelected}
      />
      <AttachmentViewBody source={source} preview={preview} extraction={extraction} view={view}>
        {mode === 'materials' && <ProcessingRetry id={source.id} />}
        {children}
      </AttachmentViewBody>
    </>
  );
}

function previewKind(kind: Source['kind'], mode: ReaderMode): PreviewKind | undefined {
  const original = attachmentReaderKind(kind);

  if (mode === 'materials') return original ?? 'file';

  return original === 'office' ? undefined : original;
}

function defaultAttachmentView(preview: PreviewKind | undefined, mode: ReaderMode): View {
  if (!preview || preview === 'text') return 'text';

  return preview === 'pdf' || mode === 'materials' ? 'preview' : 'text';
}

function AttachmentViewSelector({
  source,
  view,
  preview,
  onSelect
}: {
  source: Source;
  view: View;
  preview?: PreviewKind;
  onSelect: (view: View) => void;
}) {
  const { t } = useI18n();
  const textLabel =
    source.kind === 'audio' || source.kind === 'video'
      ? 'UploadedMaterialsTranscript'
      : 'UploadedMaterialsText';
  const previewLabel =
    preview === 'office' || preview === 'file' ? 'MaterialPreview' : 'UploadedMaterialsOriginal';

  return (
    <SourceReader.Views>
      <ToggleGroup
        aria-label={t('AttachmentReaderView')}
        value={[view]}
        onValueChange={(values) => {
          const next = values[0];

          if (next === 'preview' || next === 'text' || next === 'details') onSelect(next);
        }}
      >
        {preview && <Toggle value="preview">{t(previewLabel)}</Toggle>}
        <Toggle value="text">{t(textLabel)}</Toggle>
        <Toggle value="details">{t('UploadedMaterialsDetails')}</Toggle>
      </ToggleGroup>
    </SourceReader.Views>
  );
}

function AttachmentViewBody({
  view,
  source,
  preview,
  extraction,
  children
}: {
  view: View;
  source: Source;
  preview?: PreviewKind;
  extraction?: Extraction | null;
  children: ReactNode;
}) {
  if (view === 'details') return <AttachmentDetails source={source} />;

  if (view !== 'preview' || !preview) return children;

  if (preview === 'office')
    return (
      <StructuredAttachmentPreview source={source} extraction={extraction} feedback={children} />
    );

  if (preview === 'file') return <FileAttachmentPreview source={source} />;

  return <OriginalAttachment source={source} kind={preview} />;
}

function OriginalAttachment({ source, kind }: { source: Source; kind: OriginalKind }) {
  if (kind === 'pdf') return <SourcePdfPreview sourceId={source.id} />;

  return <OriginalFile source={source} kind={kind} />;
}

function OriginalFile({ source, kind }: { source: Source; kind: Exclude<OriginalKind, 'pdf'> }) {
  const { t } = useI18n();
  const original = rpc.sources.sourceExport.useQuery({ id: source.id });

  if (original.error)
    return <ContentReadError error={original.error} retry={() => void original.refetch()} />;

  if (!original.data) return <Loading label={t('LoadingStudy')} />;

  const { bytes } = original.data;

  if (kind === 'text') return <OriginalText bytes={bytes} code={source.kind === 'code'} />;

  return (
    <OriginalMedia
      key={encodeDigest(original.data.source.sha256)}
      kind={kind}
      source={source}
      bytes={bytes}
    />
  );
}

function OriginalText({ bytes, code }: { bytes: Uint8Array; code: boolean }) {
  const { readerFontSize } = useWorkspacePreferences();

  return (
    <SourceReader.OriginalText fontSize={readerFontSize} code={code}>
      {new TextDecoder().decode(bytes)}
    </SourceReader.OriginalText>
  );
}

function OriginalMedia({
  kind,
  source,
  bytes
}: {
  kind: Exclude<OriginalKind, 'pdf' | 'text'>;
  source: Source;
  bytes: Uint8Array;
}) {
  const { t } = useI18n();
  const [blob] = useState(() => new Blob([new Uint8Array(bytes)], { type: source.mime }));
  const url = useAttachmentPreviewUrl(blob);

  if (!url) return <Loading label={t('LoadingStudy')} />;

  return (
    <SourceReader.Original>
      <AttachmentPreview
        kind={kind}
        src={url}
        mime={source.mime}
        label={source.name}
        fallback={<ErrorState title={t('UploadedMaterialsPreviewUnavailable')} />}
      />
    </SourceReader.Original>
  );
}

function AttachmentDetails({ source }: { source: Source }) {
  const { t, date, locale } = useI18n();

  return (
    <SourceReader.Details>
      <SourceReader.Detail label={t('UploadedMaterialsFileName')} value={source.name} />
      <SourceReader.Detail
        label={t('UploadedMaterialsFormat')}
        value={t(`sourceKind.${source.kind}`)}
      />
      <SourceReader.Detail
        label={t('UploadedMaterialsSize')}
        value={mediaSize(locale, Number(source.sizeBytes))}
      />
      <SourceReader.Detail label={t('UploadedMaterialsAdded')} value={date(source.createdAt)} />
    </SourceReader.Details>
  );
}
