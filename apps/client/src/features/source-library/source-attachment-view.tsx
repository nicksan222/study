import { isDelimitedSource } from '@study/contracts';
import type { exactExtractionSchema, Source } from '@study/contracts';
import { rpc } from '@study/contracts/react';
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
import { AttachmentDetails } from './attachment-details';
import { DataAttachmentPreview } from './data-attachment-preview';
import type { ExtractionJob } from './extraction-job';
import { ExtractionSummary } from './extraction-job-view';
import { SourcePdfPreview } from './source-pdf-preview';

type View = 'preview' | 'text' | 'details';

type ReaderMode = 'materials' | 'note' | 'citation';

type PreviewKind = NonNullable<ReturnType<typeof attachmentReaderKind>> | 'data' | 'markdown';

type OriginalKind = Exclude<PreviewKind, 'data'>;

type Extraction = typeof exactExtractionSchema.Type;

const encodeDigest = Schema.encodeSync(Schema.Uint8ArrayFromHex);

type AttachmentProps = {
  source: Source;
  mode: ReaderMode;
  extraction?: Extraction | null;
  job?: ExtractionJob;
  children: ReactNode;
};

export function isFileOnlyMaterial(source?: Source | null, extraction?: Extraction | null) {
  return (
    (source?.kind === 'archive' || source?.kind === 'other') && !extraction?.document.blocks.length
  );
}

export function SourceAttachmentView({ pinned, ...props }: AttachmentProps & { pinned: boolean }) {
  const { source, mode, children, extraction, job } = props;

  if (pinned) return children;

  if (mode === 'citation')
    return source.kind === 'pdf' ? <SourcePdfPreview sourceId={source.id} /> : children;

  const preview = previewKind(source, mode);

  if (mode === 'materials' && isFileOnlyMaterial(source, extraction))
    return <AttachmentDetails source={source} job={job} />;

  return <AttachmentTabs key={String(source.id)} {...props} preview={preview} />;
}

function AttachmentTabs({
  source,
  mode,
  extraction,
  job,
  children,
  preview
}: AttachmentProps & { preview?: PreviewKind }) {
  const [selected, setSelected] = useState<View>();
  const readExtractionFirst =
    mode === 'materials' && prefersExtraction(source, preview, extraction);
  const view = selected ?? (readExtractionFirst ? 'text' : defaultAttachmentView(preview, mode));

  return (
    <>
      <AttachmentViewSelector
        source={source}
        preview={preview}
        view={view}
        onSelect={setSelected}
      />
      {job && view !== 'details' && <ExtractionSummary sourceId={source.id} job={job} allowRetry />}
      <AttachmentViewBody
        source={source}
        preview={preview}
        extraction={extraction}
        view={view}
        job={job}
      >
        {children}
      </AttachmentViewBody>
    </>
  );
}

function previewKind(source: Source, mode: ReaderMode): PreviewKind | undefined {
  if (mode === 'materials' && source.kind === 'text' && source.mime === 'text/markdown')
    return 'markdown';

  if (mode === 'materials' && isDelimitedSource(source)) return 'data';

  return attachmentReaderKind(source.kind);
}

function prefersExtraction(source: Source, preview?: PreviewKind, extraction?: Extraction | null) {
  if (!preview && ['document', 'slides', 'spreadsheet'].includes(source.kind)) return true;

  return (
    !!extraction?.document.blocks.length && ['image', 'pdf', 'video', 'audio'].includes(source.kind)
  );
}

function defaultAttachmentView(preview: PreviewKind | undefined, mode: ReaderMode): View {
  if (!preview) return mode === 'materials' ? 'details' : 'text';

  if (preview === 'text') return 'text';

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
    preview && ['data', 'markdown'].includes(preview)
      ? 'MaterialPreview'
      : 'UploadedMaterialsOriginal';

  const originalTab = preview && <Toggle value="preview">{t(previewLabel)}</Toggle>;

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
        {originalTab}
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
  job,
  children
}: {
  view: View;
  source: Source;
  preview?: PreviewKind;
  extraction?: Extraction | null;
  job?: ExtractionJob;
  children: ReactNode;
}) {
  if (view === 'details')
    return <AttachmentDetails source={source} extraction={extraction} job={job} />;

  if (view !== 'preview' || !preview) return children;

  if (preview === 'data') return <DataAttachmentPreview source={source} />;

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

  if (kind === 'markdown') return <OriginalMarkdown bytes={bytes} />;

  if (kind === 'text')
    return (
      <OriginalText
        bytes={bytes}
        code={source.kind === 'code'}
        preserveBom={source.mime === 'text/plain'}
      />
    );

  return (
    <OriginalMedia
      key={encodeDigest(original.data.source.sha256)}
      kind={kind}
      source={source}
      bytes={bytes}
    />
  );
}

function OriginalMarkdown({ bytes }: { bytes: Uint8Array }) {
  const { readerFontSize } = useWorkspacePreferences();

  return <SourceReader.Markdown bytes={bytes} fontSize={readerFontSize} />;
}

function OriginalText({
  bytes,
  code,
  preserveBom
}: {
  bytes: Uint8Array;
  code: boolean;
  preserveBom: boolean;
}) {
  const { readerFontSize } = useWorkspacePreferences();

  return (
    <SourceReader.OriginalText fontSize={readerFontSize} code={code}>
      {new TextDecoder('utf-8', { ignoreBOM: preserveBom }).decode(bytes)}
    </SourceReader.OriginalText>
  );
}

function OriginalMedia({
  kind,
  source,
  bytes
}: {
  kind: Exclude<OriginalKind, 'pdf' | 'text' | 'markdown'>;
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
