import { defineRule } from 'vite-plus/lint/plugins';

import { boundSpecifier } from '../lexical-bindings.ts';

const replacements: Record<string, Record<string, string>> = {
  Effect: {
    catchAll: 'use Effect.catch',
    catchAllCause: 'use Effect.catchCause',
    catchAllDefect: 'use Effect.catchDefect',
    catchSome: 'use Effect.catchFilter with a Filter',
    fork: 'use Effect.forkChild',
    forkDaemon: 'use Effect.forkDetach only at the application root, otherwise Effect.forkScoped'
  },
  Option: { fromNullable: 'use Option.fromNullishOr' },
  Layer: { scoped: 'use Layer.effect, which owns scoping' },
  Context: {
    Tag: 'use Context.Service',
    GenericTag: 'use Context.Service'
  }
};

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const modules = new Map<string, { module: string; specifier: any }>();

    function message(module: string, name: string): string | undefined {
      const entries = replacements[module];
      const replacement = entries && Object.hasOwn(entries, name) ? entries[name] : undefined;

      return replacement
        ? `${module}.${name} was removed in Effect v4; ${replacement}.`
        : undefined;
    }

    function propertyName(property: any, computed: boolean): string | null {
      if (!computed && property.type === 'Identifier') return property.name;

      return property.type === 'Literal' && typeof property.value === 'string'
        ? property.value
        : null;
    }

    function moduleFor(node: any): string | null {
      if (node?.type === 'Identifier') {
        const binding = modules.get(node.name);

        return binding && boundSpecifier(context, node, binding.specifier) ? binding.module : null;
      }

      if (node?.type === 'MemberExpression' && moduleFor(node.object) === 'root') {
        const name = propertyName(node.property, node.computed);

        return name !== null && Object.hasOwn(replacements, name) ? name : null;
      }

      return null;
    }

    function reportPatternProperty(property: any, module: string): void {
      if (property.type !== 'Property') return;

      const name = propertyName(property.key, property.computed);

      if (!name) return;

      if (module === 'root' && name !== null && Object.hasOwn(replacements, name)) {
        if (property.value.type === 'ObjectPattern') reportPattern(property.value, name);

        return;
      }

      const diagnostic = message(module, name);

      if (diagnostic) context.report({ node: property, message: diagnostic });
    }

    function reportPattern(pattern: any, module: string): void {
      for (const property of pattern.properties) reportPatternProperty(property, module);
    }

    function registerNamedImport(source: string, submodule: string | null, specifier: any): void {
      const name = propertyName(specifier.imported, false);

      if (source === 'effect') {
        if (name !== null && Object.hasOwn(replacements, name))
          modules.set(specifier.local.name, { module: name, specifier });

        return;
      }

      const diagnostic = submodule && name && message(submodule, name);

      if (diagnostic) context.report({ node: specifier, message: diagnostic });
    }

    function registerImport(source: string, specifier: any): void {
      if (specifier.importKind === 'type') return;

      const submodule =
        source.startsWith('effect/') && Object.hasOwn(replacements, source.slice(7))
          ? source.slice(7)
          : null;

      if (specifier.type === 'ImportNamespaceSpecifier') {
        const module = source === 'effect' ? 'root' : submodule;

        if (module) modules.set(specifier.local.name, { module, specifier });

        return;
      }

      if (specifier.type !== 'ImportSpecifier') return;

      registerNamedImport(source, submodule, specifier);
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type') return;

        const source = node.source.value;

        for (const specifier of node.specifiers) registerImport(source, specifier);
      },
      ExportNamedDeclaration(node) {
        if (!node.source || node.exportKind === 'type') return;

        const module =
          node.source.value.startsWith('effect/') &&
          Object.hasOwn(replacements, node.source.value.slice(7))
            ? node.source.value.slice(7)
            : null;

        if (!module) return;

        for (const specifier of node.specifiers) {
          if (specifier.exportKind === 'type') continue;

          const name = propertyName(specifier.local, false);
          const diagnostic = name && message(module, name);

          if (diagnostic) context.report({ node: specifier, message: diagnostic });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'ObjectPattern') return;

        const module = moduleFor(node.init);

        if (module) reportPattern(node.id, module);
      },
      AssignmentExpression(node) {
        if (node.operator !== '=' || node.left.type !== 'ObjectPattern') return;

        const module = moduleFor(node.right);

        if (module) reportPattern(node.left, module);
      },
      MemberExpression(node) {
        const module = moduleFor(node.object);
        const name = propertyName(node.property, node.computed);
        const diagnostic = module && name && message(module, name);

        if (diagnostic) context.report({ node, message: diagnostic });
      }
    };
  }
});
