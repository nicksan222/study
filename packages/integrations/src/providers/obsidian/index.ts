import { StudyError } from '@study/contracts/errors';
import { integrationPlanSchema } from '@study/contracts/integrations/schemas';
import type { integrationWarningSchema } from '@study/contracts/integrations/schemas';
import { Schema } from 'effect';

import type { IntegrationProvider } from '#integrations/capabilities';
import { integrationFiles } from '#integrations/files';

import { obsidianReferences } from './references.ts';

function note(path: string, content: string) {
  let original: string;

  try {
    original = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(content, 'base64'));
  } catch (cause) {
    throw new StudyError('invalid_input', 'Invalid UTF-8 vault note', { cause });
  }

  const normalized = original.replaceAll('\r\n', '\n');
  const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  const metadata = frontmatter?.[1] ?? null;
  const text = normalized.slice(frontmatter?.[0].length ?? 0).trim();
  const declared = /^title:\s*(.+)$/m
    .exec(metadata ?? '')?.[1]
    ?.trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  const title = [...(declared || path.split('/').at(-1)!.replace(/\.md$/i, ''))]
    .slice(0, 200)
    .join('');

  return { key: path, title, text, metadata };
}

export const obsidianProvider: IntegrationProvider = {
  id: 'obsidian',
  capabilities: {
    import: {
      plan(input) {
        const files = [...integrationFiles(input).values()]
          .filter((file) => !file.path.split('/').some((part) => part.startsWith('.')))
          .sort((a, b) => a.path.localeCompare(b.path, 'en'));
        const paths = files.map((file) => file.path);
        const warnings: (typeof integrationWarningSchema.Type)[] = [];
        const sessions: (typeof integrationPlanSchema.Type.sessions)[number][] = [];

        for (const file of files.filter((entry) => /\.md$/i.test(entry.path))) {
          const parsed = note(file.path, file.content);

          if (!parsed.text || parsed.text.length > 100000) {
            warnings.push({
              code: parsed.text ? 'oversized_note' : 'empty_note',
              path: file.path,
              target: null
            });
            continue;
          }

          const references = obsidianReferences(file.path, parsed.text, paths);

          warnings.push(...references.warnings);
          sessions.push({
            ...parsed,
            links: references.links,
            attachments: references.attachments
          });
        }

        const used = new Set(sessions.flatMap((session) => [session.key, ...session.attachments]));

        for (const file of files.filter(
          (entry) => !used.has(entry.path) && !/\.md$/i.test(entry.path)
        ))
          warnings.push({ code: 'unsupported_file', path: file.path, target: null });

        return Schema.decodeUnknownSync(integrationPlanSchema)({
          sessions,
          files: files.filter((file) => used.has(file.path)),
          warnings
        });
      }
    }
  }
};
