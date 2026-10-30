import { defineRule } from 'vite-plus/lint/plugins';

import { propertyName } from '../effect-bindings.ts';
import { imported } from '../lexical-bindings.ts';
import { webFile } from '../web-files.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    if (!webFile(context.filename)?.startsWith('routes/')) return {};

    return {
      CallExpression(node) {
        const factory = node.callee;

        if (
          factory.type !== 'CallExpression' ||
          !imported(context, factory.callee, /^@tanstack\/react-router$/, 'createFileRoute')
        )
          return;

        const options = node.arguments[0];

        if (options?.type !== 'ObjectExpression') return;

        const properties = new Map(
          options.properties
            .filter((item: any) => item.type === 'Property')
            .map((item: any) => [propertyName(item.key), item.value])
        );

        if (!requiresLoader(properties.get('staticData'))) return;

        if (!properties.has('loader') || !properties.has('loaderDeps'))
          context.report({
            node: options,
            message:
              'Library and practice routes must declare loader and loaderDeps to prepare data from validated search.'
          });
      }
    };
  }
});

function requiresLoader(metadata: any): boolean {
  if (metadata?.type !== 'ObjectExpression') return false;

  const section = metadata.properties.find(
    (item: any) => item.type === 'Property' && propertyName(item.key) === 'section'
  )?.value;

  return section?.type === 'Literal' && ['library', 'practice'].includes(section.value);
}
