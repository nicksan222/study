import { defineRule } from 'vite-plus/lint/plugins';

import {
  featureRole,
  importedValue,
  moduleEdges,
  serverPath,
  targetPath
} from '../architecture-imports.ts';
import {
  binding,
  memberName as property,
  constantDeclarator,
  enterNode
} from '../lexical-bindings.ts';

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

      forbidden ||= runtimeWorkflow(current, targetFeature, targetRole);

      forbidden ||= featureImport(node, target, db, targetFeature, targetRole, _typeOnly);

      if (forbidden)
        context.report({
          node,
          message:
            'Import crosses the feature boundary; expose only services and keep stores private.'
        });
    });

    function featureImport(
      node: any,
      target: string | null,
      db: boolean,
      targetFeature: any,
      targetRole: any,
      _typeOnly: boolean
    ) {
      if (!feature) return false;

      return [
        serviceDatabase(node, role, target, _typeOnly),
        role !== 'store' && db,
        featureTarget(role, target),
        crossFeature(node, feature, targetFeature),
        roleDependency(node, role, targetRole),
        siblingRpc(role, feature, targetFeature, targetRole),
        indexExport(node, index, feature, targetFeature, targetRole)
      ].some(Boolean);
    }

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
      if (!enterNode(node, seen)) return false;

      if (fetchGlobal(node)) return true;

      const def = binding(context, node)?.defs[0]?.node;

      return constantDeclarator(def) && globalFetch(def.init, seen);
    }

    function fetchGlobal(node: any): boolean {
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

      return false;
    }

    function rawDatabase(node: any): boolean {
      const value = importedValue(context, node);

      return (
        role === 'service' &&
        value?.target === 'platform/database/database' &&
        value.name === 'Database'
      );
    }

    function obsolete(node: any): boolean {
      const imported = importedValue(context, node);

      return (
        !!imported?.target &&
        /^features\/[^/]+\//.test(imported.target) &&
        featureRole(imported.target) === 'store' &&
        /\.(?:make|key|layer)$/.test(imported.name)
      );
    }

    function obsoleteReport(node: any) {
      context.report({
        node,
        message: 'Use useStore or transaction instead of obsolete public store bindings.'
      });
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
        if (rawDatabase(node))
          context.report({
            node,
            message: 'Use store capabilities instead of acquiring raw Database in services.'
          });

        if (obsolete(node)) obsoleteReport(node);

        if (preferencesRestricted && property(node) === 'preferences' && namespace(node.object))
          preferencesReport(node);
      },
      VariableDeclarator(node: any) {
        function checkBindings(pattern: any) {
          if (pattern.type === 'Identifier') {
            if (obsolete(pattern) || rawDatabase(pattern)) obsoleteReport(pattern);

            return;
          }

          if (pattern.type === 'ObjectPattern')
            for (const item of pattern.properties)
              if (item.type === 'Property') checkBindings(item.value);
        }

        if (node.id.type === 'ObjectPattern') checkBindings(node.id);

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

function serviceDatabase(node: any, role: any, target: any, _typeOnly: boolean) {
  let forbidden = false;

  if (role === 'service' && target === 'platform/database/database' && !_typeOnly) {
    const specifiers = node.specifiers;
    const database =
      !specifiers ||
      specifiers.length === 0 ||
      specifiers.some(
        (specifier: any) =>
          (specifier.type !== 'ImportSpecifier' && specifier.type !== 'ImportNamespaceSpecifier') ||
          (specifier.importKind !== 'type' &&
            (specifier.imported?.name ?? specifier.imported?.value) === 'Database')
      );

    forbidden ||= database;
  }

  return forbidden;
}

function crossFeature(node: any, feature: any, targetFeature: any) {
  let forbidden = false;

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

  return forbidden;
}

function indexExport(node: any, index: boolean, feature: any, targetFeature: any, targetRole: any) {
  let forbidden = false;

  if (index && node.type.startsWith('Export') && targetFeature) {
    forbidden ||= targetRole !== 'service' || node.type === 'ExportAllDeclaration';

    if (node.type === 'ExportNamedDeclaration')
      forbidden ||= node.specifiers.some(
        (s: any) =>
          s.exportKind !== 'type' &&
          !serviceName(s.exported?.name ?? s.exported?.value ?? '', feature[1]!)
      );
  }

  return forbidden;
}

function featureTarget(role: any, target: string | null): boolean {
  if (!target) return false;

  return (
    (role === 'rpc' && /^platform\/database(?:\/|$)/.test(target)) ||
    /^(?:runtime|domains|procedures|application|ai|workflows)(?:\/|$)/.test(target)
  );
}

function roleDependency(node: any, role: any, targetRole: any): boolean {
  if (targetRole === 'store')
    return !['service', 'store'].includes(role) || node.type.startsWith('Export');

  const forbidden: Record<string, string> = { service: 'workflow', store: 'service' };

  return forbidden[role] !== undefined && forbidden[role] === targetRole;
}

function siblingRpc(role: any, feature: any, targetFeature: any, targetRole: any): boolean {
  return (
    role === 'rpc' && !!targetFeature && targetFeature[1] === feature[1] && targetRole !== 'service'
  );
}

function runtimeWorkflow(current: string, feature: any, role: any): boolean {
  return (
    current.startsWith('runtime/') &&
    current !== 'runtime/workflows.ts' &&
    !!feature &&
    role === 'workflow'
  );
}
