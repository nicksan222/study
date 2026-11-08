import { RichNoteContent } from './rich-note';

/** Status announcements stay separate from token updates in the uncommitted read-only preview. */
export function GenerationPreview({
  label,
  text,
  activity,
  variant = 'inline',
  streaming = true
}: {
  label: string;
  text?: string;
  activity?: string;
  variant?: 'inline' | 'compact';
  streaming?: boolean;
}) {
  return (
    <section className="ui-generation-preview" aria-label={label} data-variant={variant}>
      <div className="ui-generation-preview-status" role="status" aria-live="polite">
        <span>{label}</span>
        {activity && <span>{activity}</span>}
      </div>
      {text && (
        <div
          className="ui-generation-preview-text"
          tabIndex={variant === 'compact' ? 0 : undefined}
          role={variant === 'compact' ? 'region' : undefined}
          aria-label={variant === 'compact' ? label : undefined}
        >
          <RichNoteContent value={text} streaming={streaming} />
        </div>
      )}
    </section>
  );
}
