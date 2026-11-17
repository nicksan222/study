import type { ChatMessage, VersionId } from '@study/contracts';

/** A generated heading belongs only to the exact content version it names. */
export function messageSectionTitle(
  message: ChatMessage,
  versionId: VersionId | null = message.activeVersionId
) {
  return message.sectionTitle?.versionId === versionId ? message.sectionTitle.title : undefined;
}
