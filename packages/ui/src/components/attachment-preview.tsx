import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

/** Shared local-media presentation; callers own URLs and revoke them after use. */
export function AttachmentPreview({
  kind,
  src,
  mime,
  label,
  fallback
}: {
  kind: 'image' | 'video' | 'audio' | 'file';
  src?: string;
  mime?: string;
  label: string;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState<string>();

  if (!src || failed === src || kind === 'file') return fallback ?? null;

  const fail = () => setFailed(src);

  return (
    <div className="ui-attachment-preview" data-kind={kind}>
      {kind === 'image' && <img src={src} alt={label} loading="lazy" onError={fail} />}
      {kind === 'video' && (
        <video
          key={src}
          controls
          muted
          playsInline
          preload="metadata"
          aria-label={label}
          onError={fail}
        >
          <source src={src} type={mime} />
        </video>
      )}
      {kind === 'audio' && (
        // Original user audio is playable before a transcript exists; do not invent a caption track.
        // oxlint-disable-next-line jsx-a11y/media-has-caption
        <audio key={src} controls preload="metadata" aria-label={label} onError={fail}>
          <source src={src} type={mime} />
        </audio>
      )}
    </div>
  );
}

/** Allocates browser URLs only while subscribed, including Strict Mode teardown/re-subscription. */
export function useAttachmentPreviewUrl(blob?: Blob) {
  const resource = useMemo(() => previewResource(blob), [blob]);

  return useSyncExternalStore(resource.subscribe, resource.snapshot, () => undefined);
}

function previewResource(blob?: Blob) {
  let url: string | undefined;
  const listeners = new Set<() => void>();

  return {
    snapshot: () => url,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      if (blob && !url && typeof URL.createObjectURL === 'function') {
        url = URL.createObjectURL(blob);

        for (const notify of listeners) notify();
      }

      return () => {
        listeners.delete(listener);

        if (!listeners.size && url) {
          URL.revokeObjectURL(url);
          url = undefined;
        }
      };
    }
  };
}
