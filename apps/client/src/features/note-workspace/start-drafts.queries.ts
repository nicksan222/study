import type { AtomRegistry } from 'effect/reactivity';
import { Atom } from 'effect/reactivity';

/** App-lifetime local drafts survive navigation and connection recovery. */
export const startDraftKey = (project?: string) => project ?? 'unassigned';

export const startDrafts = Atom.make<string[]>([]).pipe(Atom.keepAlive);

export const startDraft = Atom.family((_scope: string) => Atom.make('').pipe(Atom.keepAlive));

export const startFiles = Atom.family((_scope: string) =>
  Atom.make<File[]>([]).pipe(Atom.keepAlive)
);

export function openStartDraft(registry: AtomRegistry.AtomRegistry, project?: string) {
  const scope = startDraftKey(project);

  registry.update(startDrafts, (scopes) => (scopes.includes(scope) ? scopes : [scope, ...scopes]));
}

export function dismissStartDraft(registry: AtomRegistry.AtomRegistry, project?: string) {
  const scope = startDraftKey(project);

  registry.set(startDraft(scope), '');
  registry.set(startFiles(scope), []);
  registry.update(startDrafts, (scopes) => scopes.filter((item) => item !== scope));
}

/** A receipt consumes only its submitted snapshot; subsequent edits remain local. */
export function finishStartDraft(
  registry: AtomRegistry.AtomRegistry,
  input: { draftKey: string; filesKey: string; text: string; files: File[] }
) {
  registry.update(startFiles(input.filesKey), (current) => {
    const submitted = [...input.files];

    return current.filter((file) => {
      const index = submitted.indexOf(file);

      if (index < 0) return true;

      submitted.splice(index, 1);

      return false;
    });
  });
  registry.update(startDraft(input.draftKey), (current) => (current === input.text ? '' : current));

  if (
    !registry.get(startDraft(input.draftKey)).trim() &&
    !registry.get(startFiles(input.filesKey)).length
  )
    registry.update(startDrafts, (scopes) => scopes.filter((scope) => scope !== input.draftKey));
}
