import { RichNoteContent } from './rich-note';

/** Status announcements stay separate from token updates in the uncommitted read-only preview. */
export function GenerationPreview({
  label,
  text,
  activity
}: {
  label: string;
  text?: string;
  activity?: string;
}) {
  return (
    <section className="ui-generation-preview" aria-label={label}>
      <div className="ui-generation-preview-status" role="status" aria-live="polite">
        <span>{label}</span>
        {activity && <span>{activity}</span>}
      </div>
      {text && (
        <div className="ui-generation-preview-text">
          <RichNoteContent value={text} streaming />
        </div>
      )}
    </section>
  );
}
