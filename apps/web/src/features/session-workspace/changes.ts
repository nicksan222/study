import type { chatMessageSchema } from '@study/contracts/conversations/schemas';
import type { SessionId } from '@study/contracts/ids';

export type ChangeMessage = typeof chatMessageSchema.Type;

/** Refetched pages can overlap. Session identity remains the ownership boundary. */
export function sessionChanges(id: SessionId, messages: readonly ChangeMessage[]) {
  return [
    ...new Map(
      messages.filter((message) => message.sessionId === id).map((message) => [message.id, message])
    ).values()
  ].toSorted((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1
  );
}

export function changeVersions(message: ChangeMessage) {
  const current = message.versions.find((version) => version.id === message.activeVersionId);
  const previous =
    current?.basedOn === null
      ? undefined
      : message.versions.find((version) => version.id === current?.basedOn);

  return { current, previous };
}
