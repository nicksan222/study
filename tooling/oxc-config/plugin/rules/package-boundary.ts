import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';

import { defineRule } from 'vite-plus/lint/plugins';

const directories = {
  'packages/ui': '@study/ui',
  'packages/localization': '@study/localization',
  'packages/db': '@study/db',
  'packages/ai': '@study/ai',
  'packages/backend': '@study/backend',
  'apps/web': '@study/web',
  'apps/desktop': '@study/desktop',
  'apps/landing': 'study-landing'
} as const;

type Owner = (typeof directories)[keyof typeof directories];

const allowed: Record<Owner, readonly Owner[]> = {
  '@study/ui': [],
  '@study/localization': [],
  '@study/db': [],
  '@study/ai': ['@study/localization'],
  '@study/backend': ['@study/db', '@study/ai', '@study/localization'],
  '@study/web': ['@study/ui', '@study/localization', '@study/backend'],
  '@study/desktop': [],
  'study-landing': []
};

const exportsByPackage = new Map<string, unknown>(
  Object.entries(directories)
    .filter(([directory]) => directory.startsWith('packages/'))
    .map(([directory, name]) => {
      const manifest = JSON.parse(
        readFileSync(new URL(`../../../../${directory}/package.json`, import.meta.url), 'utf8')
      ) as { exports: unknown };

      return [name, manifest.exports] as const;
    })
);

function ownerOf(path: string): Owner | undefined {
  const normalized = path.replaceAll('\\', '/');

  return Object.entries(directories).find(([directory]) =>
    normalized.includes(`/${directory}/`)
  )?.[1];
}

// Resolve only export availability: paths are checked by the module resolver itself.
// Conditions use the standard Node import conditions in manifest order.
function hasTarget(target: unknown): boolean | undefined {
  if (typeof target === 'string') return target.startsWith('./');

  if (Array.isArray(target)) return target.some(hasTarget);

  if (target === null || typeof target !== 'object') return false;

  for (const [condition, value] of Object.entries(target)) {
    if (condition === 'import' || condition === 'node' || condition === 'default') {
      const result = hasTarget(value);

      if (result !== undefined) return result;
    }
  }

  return undefined;
}

function isPublic(name: string, subpath: string): boolean {
  const exports = exportsByPackage.get(name);
  const key = subpath ? `.${subpath}` : '.';

  if (exports === null || typeof exports !== 'object' || Array.isArray(exports)) {
    return key === '.' && hasTarget(exports) === true;
  }

  const entries = Object.entries(exports);

  if (!entries.some(([entry]) => entry.startsWith('.'))) {
    return key === '.' && hasTarget(exports) === true;
  }

  if (Object.hasOwn(exports, key))
    return hasTarget((exports as Record<string, unknown>)[key]) === true;

  const patterns = entries.filter(([entry]) => {
    const star = entry.indexOf('*');

    if (star < 0) return false;

    const prefix = entry.slice(0, star);
    const suffix = entry.slice(star + 1);

    return (
      key.startsWith(prefix) && key.endsWith(suffix) && key.length >= prefix.length + suffix.length
    );
  });

  patterns.sort(([a], [b]) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);

  return patterns.length > 0 && hasTarget(patterns[0]![1]) === true;
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const currentOwner = ownerOf(context.filename);

    if (!currentOwner) return {};

    const owner: Owner = currentOwner;

    function check(
      node: NonNullable<Parameters<typeof context.report>[0]['node']>,
      source: string
    ) {
      const packageMatch = /^(@study\/[^/]+)(\/.*)?$/.exec(source);

      if (packageMatch) {
        const name = packageMatch[1]!;
        const subpath = packageMatch[2] ?? '';

        if (!Object.values(directories).includes(name as Owner)) return;

        if (
          !exportsByPackage.has(name) &&
          name !== owner &&
          !allowed[owner].includes(name as Owner)
        ) {
          context.report({
            node,
            message: `${owner} cannot depend on ${name}; use its owning layer.`
          });
        } else if (!isPublic(name, subpath)) {
          context.report({ node, message: `${name}${subpath} is not a public package export.` });
        } else if (name !== owner && !allowed[owner].includes(name as Owner)) {
          context.report({
            node,
            message: `${owner} cannot depend on ${name}; use its owning layer.`
          });
        } else if (
          owner === '@study/web' &&
          name === '@study/backend' &&
          subpath !== '' &&
          subpath !== '/client' &&
          !subpath.startsWith('/shared/')
        ) {
          context.report({
            node,
            message:
              '@study/web must use browser-safe @study/backend root, client, or shared exports.'
          });
        }

        return;
      }

      if (
        (owner === '@study/web' || owner === '@study/ui') &&
        context.filename.replaceAll('\\', '/').includes('/src/') &&
        !/\.(?:test|spec)\.[^/]+$|\/(?:test|tests|__tests__|test-support|testing)\//.test(
          context.filename.replaceAll('\\', '/')
        ) &&
        (source.startsWith('node:') || builtinModules.includes(source))
      ) {
        context.report({ node, message: `${owner} cannot import Node builtins in browser code.` });

        return;
      }

      if (!source.startsWith('.') && !source.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(source))
        return;

      const target = resolve(dirname(context.filename), source);
      const targetOwner = ownerOf(target);

      if (
        targetOwner &&
        targetOwner !== owner &&
        /\/(?:src|test)(?:\/|$)/.test(target.replaceAll('\\', '/'))
      ) {
        context.report({
          node,
          message: `Import ${targetOwner} through its public package exports instead of a source path.`
        });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string')
          check(node, node.source.value);
      }
    };
  }
});
