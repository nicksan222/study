import { defineRule } from 'vite-plus/lint/plugins';

const width = 88;

const top = ' * ╭' + '─'.repeat(width + 2) + '╮';

const bottom = ' * ╰' + '─'.repeat(width + 2) + '╯';

function words(text: string): number {
  return text.match(/\p{L}[\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}

function detailed(text: string, minimum: number): boolean {
  return words(text) >= minimum && !/\b(?:TODO|TBD|FIXME)\b/i.test(text);
}

function validSections(lines: string[]): boolean {
  const text = lines.join('\n');
  const sections =
    /^@file ([\s\S]+?)\n\nResponsibilities:\n([\s\S]+?)\n\nBoundaries:\n([\s\S]+)$/.exec(text);

  if (!sections) return false;

  const [, overview, responsibilities, boundaries] = sections;
  const bullets = responsibilities!.split(/\n(?=- )/);

  return (
    detailed(overview!, 6) &&
    detailed(boundaries!, 6) &&
    !/^(?:-\s|@\w+(?:\s|$))/m.test(boundaries!) &&
    !/^@\w+(?:\s|$)/m.test(overview!) &&
    bullets.every((bullet) => /^- \S[^\n]*(?:\n {2}\S[^\n]*)*$/.test(bullet) && detailed(bullet, 4))
  );
}

function framedDescription(raw: string): boolean {
  const lines = raw.replaceAll('\r\n', '\n').split('\n');

  if (lines[0] !== '/**' || lines[1] !== top || lines.at(-2) !== bottom || lines.at(-1) !== ' */')
    return false;

  const content: string[] = [];

  for (const line of lines.slice(2, -2)) {
    if (!line.startsWith(' * │ ') || !line.endsWith(' │') || [...line].length !== width + 7)
      return false;

    content.push(line.slice(5, -2).trimEnd());
  }

  return validSections(content);
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Require framed server module guides with responsibilities and boundaries.'
    },
    messages: {
      description:
        'Start every server module with a framed @file guide: an overview (6+ words), Responsibilities: bullets (4+ words each), and Boundaries: prose (6+ words). Separate sections with blank rows, pad content to 88 columns inside │ borders, and use ╭/╰ borders with 90 ─ characters.',
      spacing: 'Leave a blank line between the module guide and the code or comment that follows.'
    }
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const cwd = context.cwd.replaceAll('\\', '/').replace(/\/$/, '');
    const path = filename.startsWith(cwd + '/') ? filename.slice(cwd.length) : filename;
    const workspace = path.match(/\/(?:apps|packages)\/[^/]+\//)?.[0];

    if (workspace !== '/apps/server/' || !/\.[cm]?[jt]sx?$/.test(filename)) return {};

    return {
      Program(node) {
        const source = context.sourceCode;
        const firstToken = source.getFirstToken(node);
        const firstOffset = firstToken?.range[0] ?? source.text.length;
        const comment = source
          .getAllComments()
          .find(
            (candidate) =>
              candidate.type === 'Block' &&
              candidate.range[1] <= firstOffset &&
              candidate.value.includes('@file')
          );

        if (!comment || !framedDescription(source.text.slice(...comment.range))) {
          context.report({ loc: { line: 1, column: 0 }, messageId: 'description' });

          return;
        }

        const after = source.text.slice(comment.range[1]);

        if (after.trim() && !/^\r?\n[ \t]*\r?\n/.test(after))
          context.report({ loc: comment.loc, messageId: 'spacing' });
      }
    };
  }
});
