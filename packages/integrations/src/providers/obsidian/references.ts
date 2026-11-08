import type {
  integrationNoteSchema,
  integrationWarningSchema
} from '@study/contracts/integrations/schemas';

type Warning = typeof integrationWarningSchema.Type;

type Link = (typeof integrationNoteSchema.Type.links)[number];

function relativePath(from: string, target: string) {
  const parts = from.split('/').slice(0, -1);

  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }

  return parts.join('/');
}

function resolveTarget(from: string, target: string, paths: readonly string[]) {
  const names = [target, `${target}.md`];
  const relative = names.map((name) => relativePath(from, name));
  const local = paths.filter((path) => relative.includes(path));

  if (local.length) return local;

  const exact = paths.filter((path) => names.includes(path));

  return exact.length
    ? exact
    : paths.filter((path) => names.some((name) => path.endsWith(`/${name}`)));
}

/** Mask code without changing offsets, so code examples never become vault dependencies. */
function visibleText(text: string) {
  return text.replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[^\n]*(?=\n|$)|`[^`\n]*`/g, (value) =>
    ' '.repeat(value.length)
  );
}

type Reference = {
  raw: string;
  destination: string;
  target: string;
  label: string;
  fragment: string;
  embedded: boolean;
  start: number;
  end: number;
};

function reference(match: RegExpExecArray): Reference | null {
  const wiki = match[2] !== undefined;
  const embedded = (wiki ? match[1] : match[3]) === '!';
  const [destination = '', alias] = (wiki ? match[2]! : match[5]!).split('|');

  if (!wiki && /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(destination)) return null;

  const [target = '', ...fragments] = destination.split('#');

  return {
    raw: match[0],
    destination,
    target,
    label: alias ?? (wiki ? target || fragments.join('#') : match[4]!),
    fragment: fragments.join('#'),
    embedded,
    start: match.index,
    end: match.index + match[0].length
  };
}

function unresolvedWarning(ref: Reference, ambiguous: boolean): Warning['code'] {
  if (ambiguous) return 'ambiguous_link';

  return ref.embedded ? 'missing_attachment' : 'missing_link';
}

function resolveReference(path: string, ref: Reference, paths: readonly string[]) {
  const candidates = ref.target ? resolveTarget(path, decodeTarget(ref.target), paths) : [path];
  const resolved = candidates.length === 1 ? candidates[0] : undefined;
  const warnings: Warning[] = [];
  const links: Link[] = [];
  const attachments: string[] = [];

  if (!resolved)
    warnings.push({
      code: unresolvedWarning(ref, candidates.length > 1),
      path,
      target: ref.destination
    });
  else if (!/\.md$/i.test(resolved)) attachments.push(resolved);
  else {
    links.push({ ...ref, target: resolved });

    if (ref.embedded) warnings.push({ code: 'embedded_note', path, target: ref.destination });
  }

  return { links, attachments, warnings };
}

export function obsidianReferences(path: string, text: string, paths: readonly string[]) {
  const pattern = /(!?)\[\[([^\]\n]+)\]\]|(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;
  const references = [...visibleText(text).matchAll(pattern)]
    .map(reference)
    .filter((ref) => ref !== null)
    .map((ref) => resolveReference(path, ref, paths));

  return {
    links: references.flatMap((ref) => ref.links),
    attachments: [...new Set(references.flatMap((ref) => ref.attachments))],
    warnings: references.flatMap((ref) => ref.warnings)
  };
}

function decodeTarget(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
