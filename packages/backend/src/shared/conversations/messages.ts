import type { message_versions } from '@study/db/schema';

import type { message } from '#backend/procedures/conversations/messages';
import type { recording } from '#backend/procedures/recordings/recording';
import type { SourceId } from '#backend/shared/ids';

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

export type Recording = NonNullable<ReturnType<typeof recording>>;
