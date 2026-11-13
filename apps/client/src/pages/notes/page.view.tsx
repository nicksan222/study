import type { NoteId } from '@study/contracts/ids';

import { NoteWorkspace } from '#client/features/note-workspace/index.ts';

export function PageView({ id }: { id?: NoteId }) {
  return <NoteWorkspace id={id} />;
}
