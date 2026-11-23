import type { NoteId } from '@study/contracts';
import { Atom } from 'effect/reactivity';

import { emptyDraft } from './draft';
import type { Draft } from './draft';

export const composerDraft = Atom.family((_id: NoteId) =>
  Atom.make<Draft>(emptyDraft).pipe(Atom.keepAlive)
);
