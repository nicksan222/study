import type { sessions } from '@study/db/schema';

import type { sessionRow } from '#backend/procedures/projects/projects';

export type TitleSource = (typeof sessions.$inferSelect)['title_source'];

export type ChatSession = ReturnType<typeof sessionRow>;
