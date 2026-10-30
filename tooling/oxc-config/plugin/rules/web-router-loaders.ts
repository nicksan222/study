import { defineRule } from 'vite-plus/lint/plugins';

import { propertyName } from '../effect-bindings.ts';
import { webFile } from '../web-files.ts';
import { imported } from './synchronous-transactions.ts';

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
        const metadata: any = properties.get('staticData');

        if (metadata?.type !== 'ObjectExpression') return;

        const section = metadata.properties.find(
          (item: any) => item.type === 'Property' && propertyName(item.key) === 'section'
        )?.value;

        if (section?.type !== 'Literal' || !['library', 'practice'].includes(section.value)) return;

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
