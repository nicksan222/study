import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { effectBindings, propertyName } from '../effect-bindings.ts';
import { webFile, webTarget } from '../web-files.ts';
import { nativeGlobal } from './native-global.ts';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = webFile(context.filename);

    if (!current) return {};

    const [layer, domain] = current.split('/');
    const transport = current.startsWith('lib/study-client/');
    const bindings = effectBindings(context);
    const report = (node: any, message: string) => context.report({ node, message });

    function check(node: any, source: string | null) {
      if (source === null) {
        report(node, 'Use static module imports so web ownership can be checked.');

        return;
      }

      if (!transport && rawClient(source)) {
        report(node, 'Use the browser transport adapters instead of importing a raw client.');

        return;
      }

      const target = webTarget(context.filename, source);

      if (!target) return;

      if (/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)$/.test(target)) {
        report(node, 'Production web modules cannot import test helpers or fixtures.');

        return;
      }

      if (!transport && target === 'lib/study-client/client') {
        report(node, 'Use browser request operations instead of importing the raw RPC client.');

        return;
      }

      checkOwnership(node, target);
    }

    function checkOwnership(node: any, target: string) {
      if (violatesOwnership(layer, domain, target))
        report(
          node,
          'Keep dependencies downward; pages are private and shared features expose index entry points.'
        );

      if (target === 'routeTree.gen' && current !== 'app/router.ts')
        report(node, 'Only app/router.ts may import the generated route tree.');
    }

    const edges = moduleEdges(context, check);

    return {
      ...edges,
      Program(node) {
        const entrypoint = ['main.tsx', 'routeTree.gen.ts'].includes(current);
        const owned =
          current.includes('/') &&
          ['app', 'routes', 'pages', 'features', 'lib', 'assets'].includes(layer);

        if (!entrypoint && !owned)
          report(
            node,
            'Place web modules in app, routes, pages, features or lib according to ownership.'
          );
      },
      CallExpression(node) {
        edges.CallExpression(node);

        if (transport) return;

        const callee = node.callee;
        const fetch = nativeGlobal(bindings, callee)?.replace(/^window\./, '') === 'fetch';
        const request =
          callee.type === 'MemberExpression' &&
          ['query'].includes(propertyName(callee.property) ?? '');

        if (fetch || request)
          report(node, 'Perform browser I/O through the browser transport adapters.');
      }
    };
  }
});

function violatesOwnership(layer: string, domain: string | undefined, target: string): boolean {
  const [targetLayer, targetDomain] = target.split('/');
  const upward = upwardImport(layer, targetLayer);
  const crossPage = layer === 'pages' && targetLayer === 'pages' && domain !== targetDomain;
  const featureImport =
    targetLayer === 'features' && (layer !== 'features' || domain !== targetDomain);
  const privateFeature =
    featureImport && target.split('/').length > 2 && !/^features\/[^/]+\/index$/.test(target);

  return upward || crossPage || privateFeature;
}

function rawClient(source: string): boolean {
  return (
    source === 'effect/rpc' ||
    source === '@trpc/client' ||
    source === '@study/server/client' ||
    source.startsWith('@trpc/')
  );
}

function upwardImport(layer: string, targetLayer: string): boolean {
  return (
    (layer === 'lib' && ['app', 'routes', 'pages', 'features'].includes(targetLayer)) ||
    (layer === 'features' && ['app', 'routes', 'pages'].includes(targetLayer)) ||
    (layer === 'pages' && ['app', 'routes'].includes(targetLayer))
  );
}
