import type { AtomRegistry } from 'effect/reactivity';
import { Atom } from 'effect/reactivity';

/** App-lifetime local drafts survive navigation and connection recovery. */
export const startDraftKey = (project?: string) => project ?? 'unassigned';

export const startDrafts = Atom.make<string[]>([]).pipe(Atom.keepAlive);

export const startDraft = Atom.family((_scope: string) => Atom.make('').pipe(Atom.keepAlive));

export function openStartDraft(registry: AtomRegistry.AtomRegistry, project?: string) {
  const scope = startDraftKey(project);

  registry.update(startDrafts, (scopes) => (scopes.includes(scope) ? scopes : [scope, ...scopes]));
}

export function dismissStartDraft(registry: AtomRegistry.AtomRegistry, project?: string) {
  const scope = startDraftKey(project);

  registry.set(startDraft(scope), '');
  registry.update(startDrafts, (scopes) => scopes.filter((item) => item !== scope));
}

/** A receipt consumes only its submitted snapshot; subsequent edits remain local. */
export function finishStartDraft(
  registry: AtomRegistry.AtomRegistry,
  input: { draftKey: string; text: string }
) {
  registry.update(startDraft(input.draftKey), (current) => (current === input.text ? '' : current));

  if (!registry.get(startDraft(input.draftKey)).trim())
    registry.update(startDrafts, (scopes) => scopes.filter((scope) => scope !== input.draftKey));
}
