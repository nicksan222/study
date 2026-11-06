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
      {text && <p className="ui-generation-preview-text">{text}</p>}
    </section>
  );
}
