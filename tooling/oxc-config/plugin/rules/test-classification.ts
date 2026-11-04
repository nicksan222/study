import { dirname, resolve } from 'node:path';

import { classificationLabel } from '@study/testing/classification';
import { defineRule } from 'vite-plus/lint/plugins';

import { moduleEdges } from '../architecture-imports.ts';
import { binding, constantDeclarator, enterNode, memberName } from '../lexical-bindings.ts';

const runners = /^(?:node:test|test|vitest|vite-plus\/test|@jest\/globals|bun:test)$/;

const rawNames = new Set(['test', 'it', 'fit', 'xit', 'xtest', 'ftest']);

const classifications = new Set([
  'testStable',
  'testRegression',
  'testMigration',
  'testCharacterization'
]);

const forbidden = new Set(['only', 'skip', 'todo', 'skipIf', 'runIf', 'fails', 'failing']);

function workspaceRoot(filename: string): string {
  const marker = /\/(?:apps|packages|tooling)\//.exec(filename);

  return marker ? filename.slice(0, marker.index) : dirname(filename);
}

function adapterPath(filename: string): boolean {
  return filename === resolve(workspaceRoot(filename), 'packages/testing/src/vitest.ts');
}

function importName(node: any): string | undefined {
  return node.imported?.name ?? node.imported?.value ?? node.local?.name;
}

function rawImport(node: any): boolean {
  return node.specifiers.some(
    (specifier: any) =>
      specifier.importKind !== 'type' &&
      (specifier.type !== 'ImportSpecifier' || rawNames.has(importName(specifier)!))
  );
}

function immediateUse(node: any): boolean {
  const parent = node.parent;

  return (
    (parent?.type === 'CallExpression' && parent.callee === node) ||
    (parent?.type === 'MemberExpression' && parent.object === node)
  );
}

function metadataValid(name: string, node: any): boolean {
  if (
    node?.type !== 'ObjectExpression' ||
    node.properties.some((part: any) => part.type !== 'Property' || part.computed)
  )
    return false;

  const fields = Object.fromEntries(
    node.properties.map((part: any) => [
      part.key.name ?? part.key.value,
      part.value.type === 'Literal' ? part.value.value : undefined
    ])
  );
  const kinds = {
    testRegression: 'regression',
    testMigration: 'migration',
    testCharacterization: 'characterization'
  } as const;
  const kind = kinds[name as keyof typeof kinds];

  try {
    classificationLabel(kind, fields);

    return true;
  } catch {
    return false;
  }
}

function forbiddenOptions(node: any): boolean {
  return (
    node?.type === 'ObjectExpression' &&
    node.properties.some(
      (part: any) => part.type === 'Property' && forbidden.has(part.key.name ?? part.key.value)
    )
  );
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (adapterPath(filename)) return {};

    function report(
      node: any,
      message = 'Register every test with testStable, testRegression, testMigration or testCharacterization from @study/testing/vitest.'
    ) {
      context.report({ node, message });
    }

    function adapterSource(source: string): boolean {
      return /^@study\/testing\/vitest$/.test(source);
    }

    function approved(node: any, name?: string): boolean {
      const definition = binding(context, node)?.defs[0]?.node;
      const declaration = definition?.parent;

      return (
        definition?.type === 'ImportSpecifier' &&
        declaration?.type === 'ImportDeclaration' &&
        adapterSource(declaration.source.value) &&
        (!name || importName(definition) === name)
      );
    }

    function classification(node: any): boolean {
      if (!node) return false;

      if (node.type === 'Identifier')
        return classifications.has(node.name) && approved(node, node.name);

      if (node.type === 'CallExpression') return classification(node.callee);

      if (node.type !== 'MemberExpression') return false;

      if (classification(node.object)) return true;

      return classification(node.object);
    }

    function contextAnnotation(definition: any): boolean {
      const annotation = definition.name?.typeAnnotation?.typeAnnotation;

      if (annotation?.type !== 'TSTypeReference') return false;

      const specifier = binding(context, annotation.typeName)?.defs[0]?.node;

      return (
        /^(?:node:test|vitest|vite-plus\/test)$/.test(specifier?.parent?.source?.value ?? '') &&
        importName(specifier) === 'TestContext'
      );
    }

    function testContext(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen) || node.type !== 'Identifier') return false;

      const definition = binding(context, node)?.defs[0];
      const declaration = definition?.node;

      if (constantDeclarator(declaration)) return testContext(declaration.init, seen);

      if (definition?.type !== 'Parameter') return false;

      if (contextAnnotation(definition)) return true;

      const parent = declaration.parent;

      return parent?.type === 'CallExpression' && classification(parent.callee);
    }

    function root(node: any): any {
      return node?.type === 'MemberExpression' ? root(node.object) : node;
    }

    function safeRunnerEdge(node: any): boolean {
      if (node.type === 'ImportDeclaration') return !rawImport(node);

      return (
        node.type === 'ExportNamedDeclaration' &&
        node.specifiers.every((part: any) => !rawNames.has(part.local.name))
      );
    }

    function adapterEdge(node: any): void {
      if (node.type !== 'ImportDeclaration') {
        report(
          node,
          'Import classified tests directly through their public alias; do not reexport or dynamically load registrations.'
        );

        return;
      }

      for (const part of node.specifiers) {
        if (part.type !== 'ImportSpecifier' || part.local.name !== importName(part))
          report(
            part,
            'Import classified test functions by their explicit names; aliases and namespaces hide their intent.'
          );
      }
    }

    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (!source || typeOnly) return;

      if (source.startsWith('.') && adapterPath(resolve(dirname(filename), source))) {
        report(
          node,
          'Import the classified test API through @study/testing/vitest; relative paths are forbidden.'
        );

        return;
      }

      if (runners.test(source)) {
        if (!safeRunnerEdge(node)) report(node);

        return;
      }

      if (adapterSource(source)) adapterEdge(node);
    });

    function factoryCall(node: any): void {
      const callee = node.callee;

      if (callee.type !== 'Identifier' || callee.name === 'testStable') return;

      if (!classifications.has(callee.name) || !approved(callee, callee.name)) return;

      if (!immediateUse(node))
        report(
          node,
          'Apply classified factories directly at the test definition; do not hide registrations behind aliases.'
        );

      if (!metadataValid(callee.name, node.arguments[0]))
        report(
          node,
          'Use explicit literal metadata with a known catalog identifier, valid retention and a nonempty removal condition for temporary coverage.'
        );
    }

    function registrationCall(node: any): void {
      const owner = root(node.callee);

      if (owner?.type !== 'Identifier') return;

      if (rawNames.has(owner.name) && !binding(context, owner)?.defs.length) report(node);

      if (classifications.has(owner.name) && !approved(owner, owner.name)) report(node);
    }

    return {
      ...edges,
      CallExpression(node: any) {
        edges.CallExpression(node);
        factoryCall(node);
        registrationCall(node);

        if (classification(node.callee) && forbiddenOptions(node.arguments[1]))
          report(node, 'Classified tests cannot be focused, skipped, pending or inverted.');
      },
      Identifier(node: any) {
        if (!classifications.has(node.name) || !approved(node, node.name)) return;

        const reference = binding(context, node)?.references.some(
          (part: any) => part.identifier === node
        );

        if (reference && !immediateUse(node))
          report(
            node,
            'Do not alias or pass around test registrations; keep their classification visible.'
          );
      },
      MemberExpression(node: any) {
        if (classification(node) && !immediateUse(node))
          report(node, 'Do not alias test modifiers; keep their classification visible.');

        if (
          rawNames.has(memberName(node)!) &&
          ['globalThis', 'window', 'global'].includes(node.object.name) &&
          !binding(context, node.object)?.defs.length
        )
          report(node);

        if (memberName(node) === 'test' && testContext(node.object))
          report(
            node,
            'Declare classified tests during suite collection instead of registering runtime subtests.'
          );

        if (forbidden.has(memberName(node)!) && classification(node.object))
          report(node, 'Classified tests cannot be focused, skipped, pending or inverted.');
      },
      VariableDeclarator(node: any) {
        if (
          node.id.type === 'ObjectPattern' &&
          testContext(node.init) &&
          node.id.properties.some((part: any) => part.key?.name === 'test')
        )
          report(
            node,
            'Declare classified tests during suite collection instead of extracting runtime test methods.'
          );
      }
    };
  }
});
