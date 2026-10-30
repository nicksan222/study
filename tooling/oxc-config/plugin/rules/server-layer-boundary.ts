import { defineRule } from 'vite-plus/lint/plugins';

import { featureRole, moduleEdges, serverPath, targetPath } from '../architecture-imports.ts';
import { binding, property } from './synchronous-transactions.ts';

function serviceName(name: string, feature: string): boolean {
  const owner = feature.replace(/(^|-)([a-z])/g, (_, _separator, letter) => letter.toUpperCase());

  return name === owner || name === `${owner}Service`;
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const current = serverPath(context.filename);

    if (!current || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(context.filename)) return {};

    const feature = /^features\/([^/]+)\/(.*)/.exec(current);
    const role = feature && featureRole(feature[2]!);
    const index = feature?.[2] === 'index.ts';
    const retired = /^(?:domains|procedures|application|ai|workflows)(?:\/|$)/.test(current);
    const edges = moduleEdges(context, (node, source, _typeOnly) => {
      if (!source) {
        if (feature)
          context.report({ node, message: 'Feature imports require literal module paths.' });

        return;
      }

      const target = targetPath(context.filename, source);
      const db = /^@study\/db(?:\/|$)|^drizzle-orm(?:\/|$)/.test(source);
      const targetFeature = target && /^features\/([^/]+)(?:\/(.*))?$/.exec(target);
      const targetRole = targetFeature && featureRole(targetFeature[2] ?? '');
      let forbidden = /^ts-fsrs(?:\/|$)/.test(source) && current !== 'platform/scheduling/fsrs.ts';

      forbidden ||=
        current.startsWith('runtime/') &&
        current !== 'runtime/workflows.ts' &&
        !!targetFeature &&
        targetRole === 'workflow';

      if (feature) {
        if (role !== 'store') forbidden ||= db;

        if (role === 'rpc') forbidden ||= !!target && /^platform\/database(?:\/|$)/.test(target);

        forbidden ||=
          !!target &&
          /^(?:runtime|domains|procedures|application|ai|workflows)(?:\/|$)/.test(target);

        if (targetFeature && targetFeature[1] !== feature[1]) {
          forbidden ||= !!targetFeature[2] && targetFeature[2] !== 'index';

          if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration')
            forbidden ||= node.specifiers.some(
              (s: any) =>
                (s.type !== 'ImportSpecifier' && s.type !== 'ExportSpecifier') ||
                !serviceName(s.imported?.name ?? s.local?.name ?? '', targetFeature[1]!)
            );
          else forbidden = true;
        }

        if (targetRole === 'store') forbidden ||= role !== 'service' && role !== 'store';

        if (targetRole === 'store' && node.type.startsWith('Export')) forbidden = true;

        if (role === 'service') forbidden ||= targetRole === 'workflow';

        if (role === 'store') forbidden ||= targetRole === 'service';

        if (role === 'rpc' && targetFeature && targetFeature[1] === feature[1])
          forbidden ||= targetRole !== 'service';

        if (index && node.type.startsWith('Export') && targetFeature) {
          forbidden ||= targetRole !== 'service' || node.type === 'ExportAllDeclaration';

          if (node.type === 'ExportNamedDeclaration')
            forbidden ||= node.specifiers.some(
              (s: any) =>
                s.exportKind !== 'type' &&
                !serviceName(s.exported?.name ?? s.exported?.value ?? '', feature[1]!)
            );
        }
      }

      if (forbidden)
        context.report({
          node,
          message:
            'Import crosses the feature boundary; expose only services and keep stores private.'
        });
    });

    const preferencesRestricted =
      role === 'store' &&
      !/^features\/(?:settings|auth|themes)\/(?:store\.[cm]?[jt]sx?$|[^/]+\.store\.[cm]?[jt]sx?$|store\/)/.test(
        current
      );
    const schemaSource = /^@study\/db(?:\/schema)?$/;

    function namespace(node: any, seen = new Set<any>()): boolean {
      if (node?.type !== 'Identifier' || seen.has(node)) return false;

      seen.add(node);

      return (
        binding(context, node)?.defs.some((definition: any) => {
          const declaration = definition.node;

          if (declaration.type === 'ImportNamespaceSpecifier')
            return (
              declaration.parent.importKind !== 'type' &&
              schemaSource.test(declaration.parent.source.value)
            );

          return (
            declaration.type === 'VariableDeclarator' &&
            declaration.id.type === 'Identifier' &&
            declaration.parent?.kind === 'const' &&
            namespace(declaration.init, seen)
          );
        }) ?? false
      );
    }

    function preferencesReport(node: any) {
      context.report({
        node,
        message: 'Preferences are private to settings, auth, and themes stores.'
      });
    }

    function globalFetch(node: any, seen = new Set<any>()): boolean {
      if (!node || seen.has(node)) return false;

      seen.add(node);

      if (
        node.type === 'Identifier' &&
        node.name === 'fetch' &&
        !binding(context, node)?.defs.length
      )
        return true;

      if (
        property(node) === 'fetch' &&
        node.object.type === 'Identifier' &&
        ['globalThis', 'global'].includes(node.object.name) &&
        !binding(context, node.object)?.defs.length
      )
        return true;

      const def = binding(context, node)?.defs[0]?.node;

      return (
        def?.type === 'VariableDeclarator' &&
        def.parent?.kind === 'const' &&
        globalFetch(def.init, seen)
      );
    }

    return {
      ...edges,
      ImportDeclaration(node: any) {
        edges.ImportDeclaration(node);

        if (
          !preferencesRestricted ||
          !schemaSource.test(node.source.value) ||
          node.importKind === 'type'
        )
          return;

        for (const specifier of node.specifiers)
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.importKind !== 'type' &&
            (specifier.imported.name ?? specifier.imported.value) === 'preferences'
          )
            preferencesReport(specifier);
      },
      ExportNamedDeclaration(node: any) {
        edges.ExportNamedDeclaration(node);

        if (
          !preferencesRestricted ||
          !node.source ||
          !schemaSource.test(node.source.value) ||
          node.exportKind === 'type'
        )
          return;

        for (const specifier of node.specifiers)
          if (
            specifier.exportKind !== 'type' &&
            (specifier.local.name ?? specifier.local.value) === 'preferences'
          )
            preferencesReport(specifier);
      },
      MemberExpression(node: any) {
        if (preferencesRestricted && property(node) === 'preferences' && namespace(node.object))
          preferencesReport(node);
      },
      VariableDeclarator(node: any) {
        if (!preferencesRestricted || node.id.type !== 'ObjectPattern' || !namespace(node.init))
          return;

        for (const entry of node.id.properties)
          if (
            entry.type === 'Property' &&
            ((!entry.computed && entry.key.name === 'preferences') ||
              entry.key.value === 'preferences')
          )
            preferencesReport(entry);
      },
      Program(node: any) {
        if (retired)
          context.report({
            node,
            message: 'Retired server layer: migrate to features or platform.'
          });
      },
      CallExpression(node: any) {
        edges.CallExpression(node);

        if (role === 'store' && globalFetch(node.callee))
          context.report({ node, message: 'Stores cannot make network calls.' });
      }
    };
  }
});
