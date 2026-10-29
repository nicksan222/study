import type { message_versions } from '@study/db/schema';

import type { message } from '#server/procedures/conversations/operations/messages';
import type { RecordingId, SessionId, SourceId } from '#server/shared/ids';
import type { Recording as RecordingDto } from '#server/shared/recordings/schemas';

export type VersionOrigin = (typeof message_versions.$inferSelect)['origin'];

export type VersionStatus = (typeof message_versions.$inferSelect)['status'];

export type ChatMessage = NonNullable<ReturnType<typeof message>>;

export type MessageVersion = ChatMessage['versions'][number];

export type MessagePart = ChatMessage['parts'][number];

export type NewMessage = Pick<ChatMessage, 'sessionId'> &
  Partial<Pick<ChatMessage, 'threadRoot' | 'role' | 'replyTo' | 'recordingId' | 'recordingMs'>> & {
    text: MessageVersion['text'];
    attachments?: SourceId[];
  };

export type Recording = Omit<RecordingDto, 'id' | 'sessionId'> & {
  id: RecordingId;
  sessionId: SessionId;
};
